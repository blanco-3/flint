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
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        slash_authority: Pubkey,
        stake_lockup_slots: u64,
    ) -> Result<()> {
        instructions::initialize_config::handler(ctx, slash_authority, stake_lockup_slots)
    }

    /// 슬래시 권한 업데이트
    pub fn update_slash_authority(
        ctx: Context<UpdateSlashAuthority>,
        new_slash_authority: Pubkey,
    ) -> Result<()> {
        instructions::update_slash_authority::handler(ctx, new_slash_authority)
    }

    pub fn set_pause(ctx: Context<SetPause>, paused: bool) -> Result<()> {
        instructions::set_pause::handler(ctx, paused)
    }

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

    /// 솔버 레지스트리 등록 및 담보금 예치
    pub fn register_solver(ctx: Context<RegisterSolver>, stake_amount: u64) -> Result<()> {
        instructions::register_solver::handler(ctx, stake_amount)
    }

    /// 경매가 만료되고 입찰이 없을 때 인텐트 취소 및 환불
    pub fn cancel_intent(ctx: Context<CancelIntent>) -> Result<()> {
        instructions::cancel_intent::handler(ctx)
    }

    /// 낙찰은 있었지만 미정산 timeout이 발생한 경우 환불 + 슬래시
    pub fn refund_after_timeout(ctx: Context<RefundAfterTimeout>) -> Result<()> {
        instructions::refund_after_timeout::handler(ctx)
    }

    /// 낙찰 후 불이행한 솔버를 슬래싱
    pub fn slash_solver(ctx: Context<SlashSolver>) -> Result<()> {
        instructions::slash_solver::handler(ctx)
    }

    /// 락업 종료 후 스테이크 전액 인출
    pub fn withdraw_stake(ctx: Context<WithdrawStake>) -> Result<()> {
        instructions::withdraw_stake::handler(ctx)
    }
}
