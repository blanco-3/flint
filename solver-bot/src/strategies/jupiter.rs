use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;

use crate::monitor::IntentData;

#[derive(Debug, Deserialize)]
struct QuoteResponse {
    #[serde(rename = "outAmount")]
    out_amount: String,
}

pub async fn calculate_bid(
    http: &Client,
    intent: &IntentData,
    slippage_bps: u16,
    spread_bps: u16,
    api_base: &str,
    api_key: Option<&str>,
) -> Result<u64> {
    let url = format!(
        "{}/swap/v1/quote?inputMint={}&outputMint={}&amount={}&slippageBps={}&restrictIntermediateTokens=true",
        api_base.trim_end_matches('/'),
        intent.input_mint,
        intent.output_mint,
        intent.input_amount,
        slippage_bps,
    );

    let mut request = http.get(url);
    if let Some(key) = api_key {
        request = request.header("x-api-key", key);
    }

    let quote = request
        .send()
        .await
        .context("failed to request Jupiter quote")?
        .error_for_status()
        .context("Jupiter quote request returned an error status")?
        .json::<QuoteResponse>()
        .await
        .context("failed to decode Jupiter quote response")?;

    let quoted_out_amount = quote
        .out_amount
        .parse::<u64>()
        .context("invalid outAmount in Jupiter quote")?;
    let discounted_quote =
        quoted_out_amount.saturating_mul(10_000u64.saturating_sub(spread_bps as u64)) / 10_000;

    Ok(discounted_quote.max(intent.min_output_amount.saturating_add(1)))
}
