use anchor_lang::prelude::*;

use crate::{errors::FlintError, state::ConfigAccount};

pub fn handler(
    ctx: Context<InitializeConfig>,
    slash_authority: Pubkey,
    stake_lockup_slots: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if config.admin != Pubkey::default() {
        require_keys_eq!(
            config.admin,
            ctx.accounts.admin.key(),
            FlintError::UnauthorizedConfigAdmin
        );
        msg!("config already initialized");
        return Ok(());
    }

    config.admin = ctx.accounts.admin.key();
    config.slash_authority = slash_authority;
    config.stake_lockup_slots = stake_lockup_slots;
    config.bump = ctx.bumps.config;

    msg!(
        "config initialized: admin={} slash_authority={} lockup_slots={}",
        config.admin,
        config.slash_authority,
        config.stake_lockup_slots,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + ConfigAccount::INIT_SPACE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, ConfigAccount>,

    pub system_program: Program<'info, System>,
}
