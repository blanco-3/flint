use anchor_lang::prelude::*;

use crate::{
    errors::FlintError,
    state::{ConfigAccount, SolverRegistryAccount},
};

pub fn handler(ctx: Context<WithdrawStake>) -> Result<()> {
    let current_slot = Clock::get()?.slot;
    let unlock_slot = ctx
        .accounts
        .solver_registry
        .registered_at_slot
        .saturating_add(ctx.accounts.config.stake_lockup_slots);

    require!(current_slot >= unlock_slot, FlintError::StakeLockupActive);
    require!(
        ctx.accounts.solver_registry.active_winning_bids == 0,
        FlintError::ActiveWinningBidsExist
    );

    msg!(
        "stake withdrawn: solver={} amount={}",
        ctx.accounts.solver.key(),
        ctx.accounts.solver_registry.stake_amount,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawStake<'info> {
    #[account(mut)]
    pub solver: Signer<'info>,

    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ConfigAccount>,

    #[account(
        mut,
        close = solver,
        seeds = [b"solver", solver.key().as_ref()],
        bump = solver_registry.bump,
        constraint = solver_registry.solver == solver.key() @ FlintError::NotWinningBid,
    )]
    pub solver_registry: Account<'info, SolverRegistryAccount>,
}
