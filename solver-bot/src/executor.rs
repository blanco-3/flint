use anyhow::{Context, Result};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signature, Signer},
    system_program,
    transaction::Transaction,
};

use crate::monitor::IntentData;

const SUBMIT_BID_DISCRIMINATOR: [u8; 8] = [19, 164, 237, 254, 64, 139, 237, 93];
const SETTLE_AUCTION_DISCRIMINATOR: [u8; 8] = [246, 196, 183, 98, 222, 139, 46, 133];
const REFUND_AFTER_TIMEOUT_DISCRIMINATOR: [u8; 8] = [213, 61, 128, 68, 149, 201, 53, 130];
const TOKEN_PROGRAM_ID_STR: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOCIATED_TOKEN_PROGRAM_ID_STR: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bmd";

#[derive(Debug, Clone, Copy)]
pub struct OptionalOutbidAccounts<'a> {
    pub previous_winning_bid: Option<&'a Pubkey>,
    pub previous_solver_registry: Option<&'a Pubkey>,
}

pub async fn place_bid(
    client: &RpcClient,
    payer: &Keypair,
    program_id: &Pubkey,
    intent_pda: &Pubkey,
    solver_registry: &Pubkey,
    output_amount: u64,
    previous_accounts: OptionalOutbidAccounts<'_>,
) -> Result<Signature> {
    let (bid_pda, _) = Pubkey::find_program_address(
        &[b"bid", intent_pda.as_ref(), payer.pubkey().as_ref()],
        program_id,
    );

    let previous_winning_bid = previous_accounts
        .previous_winning_bid
        .copied()
        .unwrap_or(*program_id);
    let previous_solver_registry = previous_accounts
        .previous_solver_registry
        .copied()
        .unwrap_or(*program_id);

    let instruction = Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(*solver_registry, false),
            AccountMeta::new(*intent_pda, false),
            AccountMeta::new(bid_pda, false),
            account_meta_for_optional(previous_winning_bid, program_id),
            account_meta_for_optional(previous_solver_registry, program_id),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: submit_bid_data(output_amount),
    };

    send_with_retry(client, payer, &[instruction]).await
}

pub async fn settle_auction(
    client: &RpcClient,
    payer: &Keypair,
    program_id: &Pubkey,
    intent: &IntentData,
    winning_bid: &Pubkey,
) -> Result<Signature> {
    let solver_registry = solver_registry_pda(program_id, &payer.pubkey());
    let escrow_token_account = associated_token_address(&intent.pda, &intent.input_mint);
    let solver_input_token_account = associated_token_address(&payer.pubkey(), &intent.input_mint);
    let solver_output_token_account =
        associated_token_address(&payer.pubkey(), &intent.output_mint);
    let user_output_token_account = associated_token_address(&intent.user, &intent.output_mint);
    let token_program = pubkey(TOKEN_PROGRAM_ID_STR);
    let associated_token_program = pubkey(ASSOCIATED_TOKEN_PROGRAM_ID_STR);

    let instruction = Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(intent.pda, false),
            AccountMeta::new(*winning_bid, false),
            AccountMeta::new(solver_registry, false),
            AccountMeta::new(escrow_token_account, false),
            AccountMeta::new(solver_input_token_account, false),
            AccountMeta::new(solver_output_token_account, false),
            AccountMeta::new(user_output_token_account, false),
            AccountMeta::new(intent.user, false),
            AccountMeta::new_readonly(token_program, false),
            AccountMeta::new_readonly(associated_token_program, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: SETTLE_AUCTION_DISCRIMINATOR.to_vec(),
    };

    send_with_retry(client, payer, &[instruction]).await
}

pub async fn refund_after_timeout(
    client: &RpcClient,
    caller: &Keypair,
    program_id: &Pubkey,
    intent: &IntentData,
    solver: &Pubkey,
    winning_bid: &Pubkey,
) -> Result<Signature> {
    let solver_registry = solver_registry_pda(program_id, solver);
    let escrow_token_account = associated_token_address(&intent.pda, &intent.input_mint);
    let user_token_account = associated_token_address(&intent.user, &intent.input_mint);
    let token_program = pubkey(TOKEN_PROGRAM_ID_STR);
    let associated_token_program = pubkey(ASSOCIATED_TOKEN_PROGRAM_ID_STR);

    let instruction = Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(caller.pubkey(), true),
            AccountMeta::new(*solver, false),
            AccountMeta::new(solver_registry, false),
            AccountMeta::new(intent.pda, false),
            AccountMeta::new(*winning_bid, false),
            AccountMeta::new(escrow_token_account, false),
            AccountMeta::new(user_token_account, false),
            AccountMeta::new(intent.user, false),
            AccountMeta::new_readonly(token_program, false),
            AccountMeta::new_readonly(associated_token_program, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: REFUND_AFTER_TIMEOUT_DISCRIMINATOR.to_vec(),
    };

    send_with_retry(client, caller, &[instruction]).await
}

fn submit_bid_data(output_amount: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&SUBMIT_BID_DISCRIMINATOR);
    data.extend_from_slice(&output_amount.to_le_bytes());
    data
}

async fn send_with_retry(
    client: &RpcClient,
    signer: &Keypair,
    instructions: &[Instruction],
) -> Result<Signature> {
    let mut last_error = None;

    for attempt in 1..=3 {
        let recent_blockhash = client
            .get_latest_blockhash()
            .await
            .context("failed to fetch recent blockhash")?;
        let transaction = Transaction::new_signed_with_payer(
            instructions,
            Some(&signer.pubkey()),
            &[signer],
            recent_blockhash,
        );

        match client.send_and_confirm_transaction(&transaction).await {
            Ok(signature) => return Ok(signature),
            Err(error) => {
                last_error = Some(anyhow::anyhow!(
                    "attempt {} failed to send transaction: {}",
                    attempt,
                    error
                ));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("transaction retry exhausted")))
}

fn solver_registry_pda(program_id: &Pubkey, solver: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"solver", solver.as_ref()], program_id).0
}

fn associated_token_address(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    let token_program = pubkey(TOKEN_PROGRAM_ID_STR);
    let associated_program = pubkey(ASSOCIATED_TOKEN_PROGRAM_ID_STR);
    Pubkey::find_program_address(
        &[owner.as_ref(), token_program.as_ref(), mint.as_ref()],
        &associated_program,
    )
    .0
}

fn account_meta_for_optional(pubkey: Pubkey, program_id: &Pubkey) -> AccountMeta {
    if pubkey == *program_id {
        AccountMeta::new_readonly(pubkey, false)
    } else {
        AccountMeta::new(pubkey, false)
    }
}

fn pubkey(value: &str) -> Pubkey {
    value.parse().expect("invalid static pubkey")
}
