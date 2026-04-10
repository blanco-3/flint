use anchor_lang::prelude::*;

use crate::{
    errors::FlintError,
    state::{
        BidAccount, ConfigAccount, IntentAccount, IntentStatus, SolverRegistryAccount, SLASH_BPS,
    },
};

pub fn handler(ctx: Context<SlashSolver>) -> Result<()> {
    let clock = Clock::get()?;
    let current_slot = clock.slot;
    let intent = &ctx.accounts.intent;

    require!(
        intent.status == IntentStatus::Open,
        FlintError::SlashConditionNotMet
    );
    require!(
        current_slot > intent.close_at_slot,
        FlintError::AuctionNotYetClosed
    );
    require!(
        intent.winning_bid == Some(ctx.accounts.winning_bid.key()),
        FlintError::NotWinningBid
    );
    require!(
        !ctx.accounts.winning_bid.is_settled,
        FlintError::BidAlreadySettled
    );
    require!(
        ctx.accounts.winning_bid.solver == ctx.accounts.solver_registry.solver,
        FlintError::NotWinningBid
    );
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.config.slash_authority,
        FlintError::UnauthorizedSlashAuthority
    );

    let registry = &mut ctx.accounts.solver_registry;
    let slash_amount = registry.stake_amount.saturating_mul(SLASH_BPS) / 10_000;
    let registry_info = registry.to_account_info();
    let rent = Rent::get()?;
    let space = registry_info.data_len();
    let min_balance = rent.minimum_balance(space);
    let current_lamports = registry_info.lamports();
    let safe_slash = slash_amount.min(current_lamports.saturating_sub(min_balance));

    // TODO: Replace V1 any-signer authority with governance-controlled slashing.
    **registry_info.try_borrow_mut_lamports()? -= safe_slash;
    **ctx
        .accounts
        .authority
        .to_account_info()
        .try_borrow_mut_lamports()? += safe_slash;

    let remaining_stake = registry.stake_amount.saturating_sub(safe_slash);
    registry.stake_amount = remaining_stake;
    registry.reputation_score = registry.reputation_score.saturating_sub(100);

    emit!(SolverSlashed {
        solver: registry.solver,
        slash_amount: safe_slash,
        remaining_stake,
    });

    msg!(
        "솔버 슬래싱 완료: solver={} slash={} remaining_stake={}",
        registry.solver,
        safe_slash,
        remaining_stake,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct SlashSolver<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ConfigAccount>,

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
