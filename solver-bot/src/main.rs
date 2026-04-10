mod executor;
mod monitor;
mod strategies;

use std::{path::PathBuf, str::FromStr, time::Duration};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use reqwest::Client;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    pubkey::Pubkey,
    signature::{read_keypair_file, Signer},
};
use tracing::{info, warn};

const PROGRAM_ID: &str = "5ZBavnDgcW1wnhKEiGp8KbQSHq4PcdVVosUcEX1m4bFt";

#[derive(Parser, Debug)]
#[command(name = "flint-solver")]
#[command(about = "Flint off-chain solver bot")]
struct Cli {
    #[arg(long, default_value = "http://127.0.0.1:8899")]
    rpc: String,
    #[arg(long, default_value = "~/.config/solana/id.json")]
    keypair: String,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    Run {
        #[arg(long, value_enum, default_value_t = Strategy::Naive)]
        strategy: Strategy,
        #[arg(long, default_value_t = 50)]
        slippage_bps: u16,
        #[arg(long, default_value_t = 25)]
        spread_bps: u16,
    },
    Status,
    Settle {
        #[arg(long)]
        intent: String,
        #[arg(long)]
        winning_bid: String,
    },
    Refund {
        #[arg(long)]
        intent: String,
        #[arg(long)]
        winning_bid: String,
        #[arg(long)]
        solver: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
enum Strategy {
    Naive,
    Jupiter,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_target(false).init();

    let cli = Cli::parse();
    let keypair_path = expand_home(&cli.keypair)?;
    let payer = read_keypair_file(&keypair_path).map_err(|error| {
        anyhow::anyhow!(
            "failed to read keypair {}: {}",
            keypair_path.display(),
            error
        )
    })?;
    let client = RpcClient::new(cli.rpc.clone());
    let http = Client::new();
    let program_id = Pubkey::from_str(PROGRAM_ID).context("invalid program id")?;
    let api_base =
        std::env::var("JUPITER_API_BASE").unwrap_or_else(|_| "https://api.jup.ag".to_string());
    let api_key = std::env::var("JUPITER_API_KEY").ok();

    match cli.command {
        Command::Status => {
            let slot = client
                .get_slot()
                .await
                .context("failed to fetch current slot")?;
            info!(
                rpc = %cli.rpc,
                payer = %payer.pubkey(),
                program_id = %program_id,
                slot,
                "solver bot status"
            );
        }
        Command::Run {
            strategy,
            slippage_bps,
            spread_bps,
        } => loop {
            let intents = monitor::poll_open_intents(&client, &program_id).await;

            if intents.is_empty() {
                info!("no open intents found");
            }

            for intent in intents {
                if intent.winning_bid.is_some() {
                    continue;
                }

                let solver_registry = Pubkey::find_program_address(
                    &[b"solver", payer.pubkey().as_ref()],
                    &program_id,
                )
                .0;
                let output_amount = match strategy {
                    Strategy::Naive => Ok(strategies::naive::calculate_bid(&intent)),
                    Strategy::Jupiter => {
                        strategies::jupiter::calculate_bid(
                            &http,
                            &intent,
                            slippage_bps,
                            spread_bps,
                            &api_base,
                            api_key.as_deref(),
                        )
                        .await
                    }
                };

                let output_amount = match output_amount {
                    Ok(value) => value,
                    Err(error) => {
                        warn!(intent = %intent.pda, error = %error, "failed to price intent");
                        continue;
                    }
                };

                match executor::place_bid(
                    &client,
                    &payer,
                    &program_id,
                    &intent.pda,
                    &solver_registry,
                    output_amount,
                    executor::OptionalOutbidAccounts {
                        previous_winning_bid: None,
                        previous_solver_registry: None,
                    },
                )
                .await
                {
                    Ok(signature) => info!(
                        intent = %intent.pda,
                        output_amount,
                        %signature,
                        "submitted bid"
                    ),
                    Err(error) => warn!(
                        intent = %intent.pda,
                        output_amount,
                        error = %error,
                        "failed to submit bid"
                    ),
                }
            }

            tokio::time::sleep(Duration::from_secs(2)).await;
        },
        Command::Settle {
            intent,
            winning_bid,
        } => {
            let intent_pda = Pubkey::from_str(&intent).context("invalid intent pubkey")?;
            let winning_bid = Pubkey::from_str(&winning_bid).context("invalid bid pubkey")?;
            let intent_data = monitor::fetch_intent(&client, &intent_pda).await?;
            let signature =
                executor::settle_auction(&client, &payer, &program_id, &intent_data, &winning_bid)
                    .await?;
            info!(%signature, %intent_pda, %winning_bid, "settled auction");
        }
        Command::Refund {
            intent,
            winning_bid,
            solver,
        } => {
            let intent_pda = Pubkey::from_str(&intent).context("invalid intent pubkey")?;
            let winning_bid = Pubkey::from_str(&winning_bid).context("invalid bid pubkey")?;
            let solver = Pubkey::from_str(&solver).context("invalid solver pubkey")?;
            let intent_data = monitor::fetch_intent(&client, &intent_pda).await?;
            let signature = executor::refund_after_timeout(
                &client,
                &payer,
                &program_id,
                &intent_data,
                &solver,
                &winning_bid,
            )
            .await?;
            info!(%signature, %intent_pda, %winning_bid, %solver, "refunded timeout intent");
        }
    }

    #[allow(unreachable_code)]
    Ok(())
}

fn expand_home(path: &str) -> Result<PathBuf> {
    if let Some(stripped) = path.strip_prefix("~/") {
        let home = std::env::var("HOME").context("HOME is not set")?;
        return Ok(PathBuf::from(home).join(stripped));
    }

    if path == "~" {
        let home = std::env::var("HOME").context("HOME is not set")?;
        return Ok(PathBuf::from(home));
    }

    Ok(PathBuf::from(path))
}
