mod executor;
mod monitor;
mod strategies;

use std::{path::PathBuf, str::FromStr, time::Duration};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use solana_client::rpc_client::RpcClient;
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
    Run,
    Status,
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
    let program_id = Pubkey::from_str(PROGRAM_ID).context("invalid program id")?;

    match cli.command {
        Command::Status => {
            let slot = client.get_slot().context("failed to fetch current slot")?;
            info!(
                rpc = %cli.rpc,
                payer = %payer.pubkey(),
                program_id = %program_id,
                slot,
                "solver bot status"
            );
        }
        Command::Run => loop {
            let intents = monitor::poll_open_intents(&client, &program_id).await;

            if intents.is_empty() {
                info!("no open intents found");
            }

            for intent in intents {
                let output_amount = strategies::naive::calculate_bid(&intent);
                match executor::place_bid(&client, &payer, &program_id, &intent.pda, output_amount)
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
