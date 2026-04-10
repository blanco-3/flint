use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

use crate::{
    errors::FlintError,
    state::{
        BidAccount, IntentAccount, IntentStatus, SolverRegistryAccount, REFUND_GRACE_SLOTS,
        SLASH_BPS,
    },
};

pub fn handler(ctx: Context<RefundAfterTimeout>) -> Result<()> {
    let current_slot = Clock::get()?.slot;

    {
        let intent = &ctx.accounts.intent;

        require!(
            intent.status == IntentStatus::Open,
            FlintError::IntentNotOpen
        );
        require!(
            current_slot > intent.close_at_slot + REFUND_GRACE_SLOTS,
            FlintError::RefundGracePeriodNotElapsed
        );
        require!(intent.winning_bid.is_some(), FlintError::NoBidsReceived);
        require!(
            intent.winning_bid == Some(ctx.accounts.winning_bid.key()),
            FlintError::NotWinningBid
        );
        require!(
            ctx.accounts.winning_bid.intent == intent.key(),
            FlintError::NotWinningBid
        );
        require!(
            !ctx.accounts.winning_bid.is_settled,
            FlintError::AlreadySettled
        );
        require!(
            ctx.accounts.winning_bid.solver == ctx.accounts.solver.key(),
            FlintError::NotWinningBid
        );
        require!(
            ctx.accounts.solver_registry.solver == ctx.accounts.solver.key(),
            FlintError::NotWinningBid
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

    let registry = &mut ctx.accounts.solver_registry;
    let slash_amount = registry.stake_amount.saturating_mul(SLASH_BPS) / 10_000;
    let registry_info = registry.to_account_info();
    let min_balance = Rent::get()?.minimum_balance(registry_info.data_len());
    let withdrawable_lamports = registry_info.lamports().saturating_sub(min_balance);
    let safe_slash = slash_amount.min(withdrawable_lamports);

    **registry_info.try_borrow_mut_lamports()? -= safe_slash;
    **ctx
        .accounts
        .caller
        .to_account_info()
        .try_borrow_mut_lamports()? += safe_slash;

    registry.stake_amount = registry.stake_amount.saturating_sub(safe_slash);
    registry.reputation_score = registry.reputation_score.saturating_sub(100);

    let winning_bid = &mut ctx.accounts.winning_bid;
    winning_bid.is_settled = true;

    let intent = &mut ctx.accounts.intent;
    intent.status = IntentStatus::Expired;

    emit!(IntentRefundedAfterTimeout {
        intent: intent.key(),
        user: intent.user,
        solver: ctx.accounts.solver.key(),
        caller: ctx.accounts.caller.key(),
        refunded_amount: refund_amount,
        slash_amount: safe_slash,
    });

    msg!(
        "timeout 환불 완료: intent={} user={} solver={} refunded={} slash={}",
        intent.key(),
        intent.user,
        ctx.accounts.solver.key(),
        refund_amount,
        safe_slash,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct RefundAfterTimeout<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    pub solver: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [b"solver", solver.key().as_ref()],
        bump = solver_registry.bump,
    )]
    pub solver_registry: Account<'info, SolverRegistryAccount>,

    #[account(mut)]
    pub intent: Account<'info, IntentAccount>,

    #[account(mut)]
    pub winning_bid: Account<'info, BidAccount>,

    #[account(
        mut,
        associated_token::mint = intent.input_mint,
        associated_token::authority = intent,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = intent.input_mint,
        associated_token::authority = intent.user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut, address = intent.user)]
    pub user: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct IntentRefundedAfterTimeout {
    pub intent: Pubkey,
    pub user: Pubkey,
    pub solver: Pubkey,
    pub caller: Pubkey,
    pub refunded_amount: u64,
    pub slash_amount: u64,
}
