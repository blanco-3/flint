use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("5ZBavnDgcW1wnhKEiGp8KbQSHq4PcdVVosUcEX1m4bFt");

#[program]
pub mod flint {
    use super::*;

    /// 유저가 인텐트를 제출하고 토큰을 에스크로에 잠금
    /// nonce: unix timestamp 등 클라이언트 제공 유니크 값
    pub fn submit_intent(
        ctx: Context<SubmitIntent>,
        input_amount: u64,
        min_output_amount: u64,
        nonce: u64,
    ) -> Result<()> {
        instructions::submit_intent::handler(ctx, input_amount, min_output_amount, nonce)
    }

    /// 솔버가 인텐트에 입찰 (경매 창 내에서만 유효)
    pub fn submit_bid(ctx: Context<SubmitBid>, output_amount: u64) -> Result<()> {
        instructions::submit_bid::handler(ctx, output_amount)
    }

    /// 경매 창 종료 후 낙찰 정산 — 원자적으로 토큰 교환
    pub fn settle_auction(ctx: Context<SettleAuction>) -> Result<()> {
        instructions::settle_auction::handler(ctx)
    }
}
