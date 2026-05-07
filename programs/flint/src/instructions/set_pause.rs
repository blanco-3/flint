use anchor_lang::prelude::*;

use crate::{errors::FlintError, state::{ConfigAccount, PauseState}};

pub fn handler(ctx: Context<SetPause>, paused: bool) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.admin,
        ctx.accounts.admin.key(),
        FlintError::UnauthorizedConfigAdmin
    );

    ctx.accounts.pause_state.is_paused = paused;
    ctx.accounts.pause_state.bump = ctx.bumps.pause_state;

    msg!(
        "pause updated: admin={} paused={}",
        ctx.accounts.admin.key(),
        paused,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct SetPause<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ConfigAccount>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + PauseState::INIT_SPACE,
        seeds = [b"pause"],
        bump,
    )]
    pub pause_state: Account<'info, PauseState>,

    pub system_program: Program<'info, System>,
}
