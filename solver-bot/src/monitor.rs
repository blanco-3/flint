use solana_client::{
    nonblocking::rpc_client::RpcClient,
    rpc_config::RpcProgramAccountsConfig,
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_sdk::pubkey::Pubkey;
use tracing::warn;

const INTENT_ACCOUNT_DISCRIMINATOR: [u8; 8] = [247, 124, 161, 252, 52, 195, 5, 3];
const OPEN_STATUS_OFFSET: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 33;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IntentStatus {
    Open,
    Filled,
    Expired,
    Cancelled,
}

#[derive(Debug, Clone)]
pub struct IntentData {
    pub pda: Pubkey,
    pub user: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub input_amount: u64,
    pub min_output_amount: u64,
    pub open_at_slot: u64,
    pub close_at_slot: u64,
    pub best_bid_amount: u64,
    pub winning_bid: Option<Pubkey>,
    pub status: IntentStatus,
    pub nonce: u64,
    pub bump: u8,
}

pub async fn poll_open_intents(client: &RpcClient, program_id: &Pubkey) -> Vec<IntentData> {
    let config = RpcProgramAccountsConfig {
        filters: Some(vec![RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
            OPEN_STATUS_OFFSET,
            vec![0],
        ))]),
        ..RpcProgramAccountsConfig::default()
    };

    match client
        .get_program_accounts_with_config(program_id, config)
        .await
    {
        Ok(accounts) => accounts
            .into_iter()
            .filter_map(|(pubkey, account)| parse_intent(pubkey, &account.data))
            .collect(),
        Err(error) => {
            warn!(error = %error, %program_id, "failed to fetch open intents");
            Vec::new()
        }
    }
}

pub async fn fetch_intent(client: &RpcClient, intent_pda: &Pubkey) -> anyhow::Result<IntentData> {
    let account = client
        .get_account(intent_pda)
        .await
        .map_err(|error| anyhow::anyhow!("failed to fetch intent {}: {}", intent_pda, error))?;

    parse_intent(*intent_pda, &account.data)
        .ok_or_else(|| anyhow::anyhow!("failed to decode intent account {}", intent_pda))
}

fn parse_intent(pda: Pubkey, data: &[u8]) -> Option<IntentData> {
    if data.len() < 8 || data[..8] != INTENT_ACCOUNT_DISCRIMINATOR {
        return None;
    }

    let mut cursor = &data[8..];

    let user = read_pubkey(&mut cursor)?;
    let input_mint = read_pubkey(&mut cursor)?;
    let output_mint = read_pubkey(&mut cursor)?;
    let input_amount = read_u64(&mut cursor)?;
    let min_output_amount = read_u64(&mut cursor)?;
    let open_at_slot = read_u64(&mut cursor)?;
    let close_at_slot = read_u64(&mut cursor)?;
    let best_bid_amount = read_u64(&mut cursor)?;
    let winning_bid = read_option_pubkey(&mut cursor)?;
    let status = read_status(&mut cursor)?;
    let nonce = read_u64(&mut cursor)?;
    let bump = read_u8(&mut cursor)?;

    Some(IntentData {
        pda,
        user,
        input_mint,
        output_mint,
        input_amount,
        min_output_amount,
        open_at_slot,
        close_at_slot,
        best_bid_amount,
        winning_bid,
        status,
        nonce,
        bump,
    })
}

fn read_pubkey(cursor: &mut &[u8]) -> Option<Pubkey> {
    if cursor.len() < 32 {
        return None;
    }

    let (bytes, rest) = cursor.split_at(32);
    *cursor = rest;
    Some(Pubkey::new_from_array(bytes.try_into().ok()?))
}

fn read_u64(cursor: &mut &[u8]) -> Option<u64> {
    if cursor.len() < 8 {
        return None;
    }

    let (bytes, rest) = cursor.split_at(8);
    *cursor = rest;
    Some(u64::from_le_bytes(bytes.try_into().ok()?))
}

fn read_u8(cursor: &mut &[u8]) -> Option<u8> {
    let (value, rest) = cursor.split_first()?;
    *cursor = rest;
    Some(*value)
}

fn read_option_pubkey(cursor: &mut &[u8]) -> Option<Option<Pubkey>> {
    match read_u8(cursor)? {
        0 => Some(None),
        1 => Some(Some(read_pubkey(cursor)?)),
        _ => None,
    }
}

fn read_status(cursor: &mut &[u8]) -> Option<IntentStatus> {
    match read_u8(cursor)? {
        0 => Some(IntentStatus::Open),
        1 => Some(IntentStatus::Filled),
        2 => Some(IntentStatus::Expired),
        3 => Some(IntentStatus::Cancelled),
        _ => None,
    }
}
