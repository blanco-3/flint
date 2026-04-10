use anyhow::{Context, Result};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signature, Signer},
    system_program,
    transaction::Transaction,
};

const SUBMIT_BID_DISCRIMINATOR: [u8; 8] = [19, 164, 237, 254, 64, 139, 237, 93];

pub async fn place_bid(
    client: &RpcClient,
    payer: &Keypair,
    program_id: &Pubkey,
    intent_pda: &Pubkey,
    output_amount: u64,
) -> Result<Signature> {
    let (bid_pda, _) = Pubkey::find_program_address(
        &[b"bid", intent_pda.as_ref(), payer.pubkey().as_ref()],
        program_id,
    );

    let instruction = Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(*intent_pda, false),
            AccountMeta::new(bid_pda, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: submit_bid_data(output_amount),
    };

    let recent_blockhash = client
        .get_latest_blockhash()
        .await
        .context("failed to fetch recent blockhash")?;
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&payer.pubkey()),
        &[payer],
        recent_blockhash,
    );

    client
        .send_and_confirm_transaction(&transaction)
        .await
        .context("failed to send submit_bid transaction")
}

fn submit_bid_data(output_amount: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&SUBMIT_BID_DISCRIMINATOR);
    data.extend_from_slice(&output_amount.to_le_bytes());
    data
}
