use anchor_lang::prelude::*;

use crate::{errors::FlintError, state::ConfigAccount};

pub fn handler(ctx: Context<UpdateSlashAuthority>, new_slash_authority: Pubkey) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.admin,
        ctx.accounts.admin.key(),
        FlintError::UnauthorizedConfigAdmin
    );

    ctx.accounts.config.slash_authority = new_slash_authority;

    msg!(
        "slash authority updated: admin={} new_slash_authority={}",
        ctx.accounts.admin.key(),
        new_slash_authority,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateSlashAuthority<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ConfigAccount>,
}
