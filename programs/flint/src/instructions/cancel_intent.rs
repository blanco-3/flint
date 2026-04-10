use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

use crate::{
    errors::FlintError,
    state::{IntentAccount, IntentStatus},
};

pub fn handler(ctx: Context<CancelIntent>) -> Result<()> {
    let current_slot = Clock::get()?.slot;

    {
        let intent = &ctx.accounts.intent;
        require!(
            intent.status == IntentStatus::Open,
            FlintError::IntentNotOpen
        );
        require!(intent.winning_bid.is_none(), FlintError::HasActiveBid);
        require!(
            current_slot > intent.close_at_slot,
            FlintError::AuctionWindowStillOpen
        );
    }

    let refund_amount = ctx.accounts.intent.input_amount;
    let nonce_bytes = ctx.accounts.intent.nonce.to_le_bytes();
    let seeds = &[
        b"intent" as &[u8],
        ctx.accounts.intent.user.as_ref(),
        &nonce_bytes,
        &[ctx.accounts.intent.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let refund_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.intent.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(refund_ctx, refund_amount)?;

    let close_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.escrow_token_account.to_account_info(),
            destination: ctx.accounts.user.to_account_info(),
            authority: ctx.accounts.intent.to_account_info(),
        },
        signer_seeds,
    );
    token::close_account(close_ctx)?;

    let intent = &mut ctx.accounts.intent;
    intent.status = IntentStatus::Cancelled;

    emit!(IntentCancelled {
        intent: intent.key(),
        user: intent.user,
        refunded_amount: refund_amount,
    });

    msg!(
        "인텐트 취소 완료: intent={} user={} refunded={}",
        intent.key(),
        intent.user,
        refund_amount,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct CancelIntent<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        constraint = intent.user == user.key(),
    )]
    pub intent: Account<'info, IntentAccount>,

    #[account(
        mut,
        associated_token::mint = intent.input_mint,
        associated_token::authority = intent,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = intent.input_mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct IntentCancelled {
    pub intent: Pubkey,
    pub user: Pubkey,
    pub refunded_amount: u64,
}
