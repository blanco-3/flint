use anchor_lang::prelude::*;
use crate::state::{BidAccount, IntentAccount, IntentStatus};
use crate::errors::FlintError;

pub fn handler(ctx: Context<SubmitBid>, output_amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    let current_slot = clock.slot;

    let intent = &mut ctx.accounts.intent;

    // 경매 창 유효성 검사
    require!(
        intent.status == IntentStatus::Open,
        FlintError::IntentNotOpen
    );
    require!(
        current_slot <= intent.close_at_slot,
        FlintError::AuctionClosed
    );

    // 최소 output 충족 여부
    require!(
        output_amount >= intent.min_output_amount,
        FlintError::BidBelowMinimum
    );

    // 현재 최고가보다 높아야 함
    require!(
        output_amount > intent.best_bid_amount,
        FlintError::BidNotHigherThanBest
    );

    // 인텐트 최고가 갱신
    intent.best_bid_amount = output_amount;
    intent.winning_bid = Some(ctx.accounts.bid.key());

    let bid = &mut ctx.accounts.bid;
    bid.solver = ctx.accounts.solver.key();
    bid.intent = ctx.accounts.intent.key();
    bid.output_amount = output_amount;
    bid.submitted_at_slot = current_slot;
    bid.is_settled = false;
    bid.bump = ctx.bumps.bid;

    emit!(BidSubmitted {
        bid: bid.key(),
        intent: bid.intent,
        solver: bid.solver,
        output_amount,
        submitted_at_slot: current_slot,
    });

    msg!(
        "입찰: 솔버={} output={} (슬롯 {})",
        bid.solver,
        output_amount,
        current_slot,
    );

    Ok(())
}

#[derive(Accounts)]
#[instruction(output_amount: u64)]
pub struct SubmitBid<'info> {
    #[account(mut)]
    pub solver: Signer<'info>,

    #[account(
        mut,
        constraint = intent.status == IntentStatus::Open @ FlintError::IntentNotOpen,
    )]
    pub intent: Account<'info, IntentAccount>,

    /// BidAccount PDA: seeds = [b"bid", intent, solver]
    /// 솔버당 인텐트에 하나의 입찰만 허용
    #[account(
        init,
        payer = solver,
        space = 8 + BidAccount::INIT_SPACE,
        seeds = [b"bid", intent.key().as_ref(), solver.key().as_ref()],
        bump,
    )]
    pub bid: Account<'info, BidAccount>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct BidSubmitted {
    pub bid: Pubkey,
    pub intent: Pubkey,
    pub solver: Pubkey,
    pub output_amount: u64,
    pub submitted_at_slot: u64,
}
