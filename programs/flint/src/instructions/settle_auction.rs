use crate::errors::FlintError;
use crate::state::{require_not_paused, BidAccount, IntentAccount, IntentStatus, SolverRegistryAccount};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

pub fn handler(ctx: Context<SettleAuction>) -> Result<()> {
    require_not_paused(&ctx.accounts.pause_state)?;
    let clock = Clock::get()?;
    let current_slot = clock.slot;

    {
        let intent = &ctx.accounts.intent;

        require!(
            intent.status == IntentStatus::Open,
            FlintError::IntentNotOpen
        );
        require!(
            current_slot > intent.close_at_slot,
            FlintError::AuctionStillOpen
        );
        require!(intent.winning_bid.is_some(), FlintError::NoBidsReceived);
        require!(
            intent.winning_bid == Some(ctx.accounts.winning_bid.key()),
            FlintError::NotWinningBid
        );
    }

    let intent_key = ctx.accounts.intent.key();
    let intent_bump = ctx.accounts.intent.bump;

    // 에스크로 → 솔버: input 토큰 전송 (솔버가 유저 대신 토큰을 집어간 후 output 줌)
    let nonce_bytes = ctx.accounts.intent.nonce.to_le_bytes();
    let seeds = &[
        b"intent" as &[u8],
        ctx.accounts.intent.user.as_ref(),
        &nonce_bytes,
        &[intent_bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let transfer_to_solver = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.solver_input_token_account.to_account_info(),
            authority: ctx.accounts.intent.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_to_solver, ctx.accounts.intent.input_amount)?;

    // 솔버 → 유저: output 토큰 전송
    let output_amount = ctx.accounts.winning_bid.output_amount;
    let transfer_to_user = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.solver_output_token_account.to_account_info(),
            to: ctx.accounts.user_output_token_account.to_account_info(),
            authority: ctx.accounts.solver.to_account_info(),
        },
    );
    token::transfer(transfer_to_user, output_amount)?;

    let close_escrow_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.escrow_token_account.to_account_info(),
            destination: ctx.accounts.user.to_account_info(),
            authority: ctx.accounts.intent.to_account_info(),
        },
        signer_seeds,
    );
    token::close_account(close_escrow_ctx)?;

    // 상태 업데이트
    let solver_registry = &mut ctx.accounts.solver_registry;
    solver_registry.active_winning_bids = solver_registry.active_winning_bids.saturating_sub(1);
    solver_registry.total_fills = solver_registry.total_fills.saturating_add(1);

    let intent = &mut ctx.accounts.intent;
    intent.status = IntentStatus::Filled;

    let bid = &mut ctx.accounts.winning_bid;
    bid.is_settled = true;

    emit!(AuctionSettled {
        intent: intent_key,
        winning_bid: bid.key(),
        solver: bid.solver,
        user: intent.user,
        input_amount: intent.input_amount,
        output_amount,
    });

    msg!(
        "경매 정산 완료: 유저={} 솔버={} input={} output={}",
        intent.user,
        bid.solver,
        intent.input_amount,
        output_amount,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct SettleAuction<'info> {
    /// 정산을 트리거하는 사람 (누구나 가능 — 솔버 봇이 호출)
    #[account(mut)]
    pub solver: Signer<'info>,

    /// CHECK: pause PDA can be empty/system-owned until the first explicit pause toggle.
    #[account(seeds = [b"pause"], bump)]
    pub pause_state: UncheckedAccount<'info>,

    #[account(
        mut,
        close = user,
        constraint = intent.status == IntentStatus::Open @ FlintError::IntentNotOpen,
    )]
    pub intent: Box<Account<'info, IntentAccount>>,

    #[account(
        mut,
        close = solver,
        constraint = winning_bid.intent == intent.key() @ FlintError::NotWinningBid,
        constraint = !winning_bid.is_settled @ FlintError::AlreadySettled,
        constraint = winning_bid.solver == solver.key() @ FlintError::NotWinningBid,
    )]
    pub winning_bid: Box<Account<'info, BidAccount>>,

    #[account(
        mut,
        seeds = [b"solver", solver.key().as_ref()],
        bump = solver_registry.bump,
        constraint = solver_registry.solver == solver.key() @ FlintError::NotWinningBid,
    )]
    pub solver_registry: Box<Account<'info, SolverRegistryAccount>>,

    /// 에스크로 (intent PDA authority)
    #[account(
        mut,
        associated_token::mint = intent.input_mint,
        associated_token::authority = intent,
    )]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    /// 솔버의 input 토큰 수신 계정
    #[account(
        mut,
        associated_token::mint = intent.input_mint,
        associated_token::authority = solver,
    )]
    pub solver_input_token_account: Box<Account<'info, TokenAccount>>,

    /// 솔버의 output 토큰 송신 계정
    #[account(
        mut,
        associated_token::mint = intent.output_mint,
        associated_token::authority = solver,
    )]
    pub solver_output_token_account: Box<Account<'info, TokenAccount>>,

    /// 유저의 output 토큰 수신 계정
    #[account(
        mut,
        associated_token::mint = intent.output_mint,
        associated_token::authority = intent.user,
    )]
    pub user_output_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut, address = intent.user)]
    pub user: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct AuctionSettled {
    pub intent: Pubkey,
    pub winning_bid: Pubkey,
    pub solver: Pubkey,
    pub user: Pubkey,
    pub input_amount: u64,
    pub output_amount: u64,
}
