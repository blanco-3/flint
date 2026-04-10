use anchor_lang::prelude::*;

use crate::{
    errors::FlintError,
    state::{BidAccount, IntentAccount, IntentStatus, SolverRegistryAccount, SLASH_BPS},
};

pub fn handler(ctx: Context<SlashSolver>) -> Result<()> {
    let intent = &ctx.accounts.intent;
    require!(
        intent.status == IntentStatus::Filled,
        FlintError::IntentNotOpen
    );
    require!(
        intent.winning_bid == Some(ctx.accounts.winning_bid.key()),
        FlintError::NotWinningBid
    );
    require!(
        ctx.accounts.winning_bid.solver == ctx.accounts.solver_registry.solver,
        FlintError::NotWinningBid
    );

    let registry = &mut ctx.accounts.solver_registry;
    let slash_amount = registry.stake_amount.saturating_mul(SLASH_BPS) / 10_000;
    let remaining_stake = registry.stake_amount.saturating_sub(slash_amount);

    // TODO: Replace V1 any-signer authority with governance-controlled slashing.
    **registry.to_account_info().try_borrow_mut_lamports()? -= slash_amount;
    **ctx
        .accounts
        .authority
        .to_account_info()
        .try_borrow_mut_lamports()? += slash_amount;

    registry.stake_amount = remaining_stake;
    registry.reputation_score = registry.reputation_score.saturating_sub(100);

    emit!(SolverSlashed {
        solver: registry.solver,
        slash_amount,
        remaining_stake,
    });

    msg!(
        "솔버 슬래싱 완료: solver={} slash={} remaining_stake={}",
        registry.solver,
        slash_amount,
        remaining_stake,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct SlashSolver<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub solver: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [b"solver", solver.key().as_ref()],
        bump = solver_registry.bump,
    )]
    pub solver_registry: Account<'info, SolverRegistryAccount>,

    pub intent: Account<'info, IntentAccount>,

    #[account(
        constraint = winning_bid.intent == intent.key() @ FlintError::NotWinningBid,
        constraint = winning_bid.solver == solver.key() @ FlintError::NotWinningBid,
    )]
    pub winning_bid: Account<'info, BidAccount>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct SolverSlashed {
    pub solver: Pubkey,
    pub slash_amount: u64,
    pub remaining_stake: u64,
}
