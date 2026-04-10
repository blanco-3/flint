use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::{
    errors::FlintError,
    state::{SolverRegistryAccount, MIN_STAKE_LAMPORTS},
};

pub fn handler(ctx: Context<RegisterSolver>, stake_amount: u64) -> Result<()> {
    require!(
        stake_amount >= MIN_STAKE_LAMPORTS,
        FlintError::InsufficientStake
    );

    let solver = ctx.accounts.solver.key();
    let current_slot = Clock::get()?.slot;

    let transfer_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
            from: ctx.accounts.solver.to_account_info(),
            to: ctx.accounts.solver_registry.to_account_info(),
        },
    );
    system_program::transfer(transfer_ctx, stake_amount)?;

    let registry = &mut ctx.accounts.solver_registry;
    registry.solver = solver;
    registry.stake_amount = stake_amount;
    registry.total_bids = 0;
    registry.total_fills = 0;
    registry.active_winning_bids = 0;
    registry.reputation_score = 1000;
    registry.registered_at_slot = current_slot;
    registry.bump = ctx.bumps.solver_registry;

    emit!(SolverRegistered {
        solver,
        stake_amount,
    });

    msg!(
        "솔버 등록 완료: solver={} stake={} slot={}",
        solver,
        stake_amount,
        current_slot,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct RegisterSolver<'info> {
    #[account(mut)]
    pub solver: Signer<'info>,

    #[account(
        init,
        payer = solver,
        space = 8 + SolverRegistryAccount::INIT_SPACE,
        seeds = [b"solver", solver.key().as_ref()],
        bump,
    )]
    pub solver_registry: Account<'info, SolverRegistryAccount>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct SolverRegistered {
    pub solver: Pubkey,
    pub stake_amount: u64,
}
