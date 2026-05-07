use crate::errors::FlintError;
use crate::state::{require_not_paused, IntentAccount, IntentStatus, AUCTION_WINDOW_SLOTS};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

/// nonce: 클라이언트가 제공하는 유니크 값 (unix timestamp 권장)
/// seeds에 Clock::get()을 직접 쓰면 스택이 넘치므로 인자로 받음
pub fn handler(
    ctx: Context<SubmitIntent>,
    input_amount: u64,
    min_output_amount: u64,
    _nonce: u64,
) -> Result<()> {
    require_not_paused(&ctx.accounts.pause_state)?;
    require!(input_amount > 0, FlintError::ZeroAmount);
    require!(min_output_amount > 0, FlintError::ZeroAmount);

    let clock = Clock::get()?;
    let open_slot = clock.slot;
    let close_slot = open_slot + AUCTION_WINDOW_SLOTS;

    // 유저 토큰 → 에스크로 PDA로 전송
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.escrow_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, input_amount)?;

    let intent = &mut ctx.accounts.intent;
    intent.user = ctx.accounts.user.key();
    intent.input_mint = ctx.accounts.input_mint.key();
    intent.output_mint = ctx.accounts.output_mint.key();
    intent.input_amount = input_amount;
    intent.min_output_amount = min_output_amount;
    intent.open_at_slot = open_slot;
    intent.close_at_slot = close_slot;
    intent.best_bid_amount = 0;
    intent.winning_bid = None;
    intent.status = IntentStatus::Open;
    intent.nonce = _nonce;
    intent.bump = ctx.bumps.intent;

    emit!(IntentSubmitted {
        intent: intent.key(),
        user: intent.user,
        input_mint: intent.input_mint,
        output_mint: intent.output_mint,
        input_amount,
        min_output_amount,
        close_at_slot: close_slot,
    });

    msg!(
        "인텐트 제출: {} {} → {} (최소: {}, 슬롯 {}~{})",
        input_amount,
        intent.input_mint,
        intent.output_mint,
        min_output_amount,
        open_slot,
        close_slot,
    );

    Ok(())
}

#[derive(Accounts)]
#[instruction(input_amount: u64, min_output_amount: u64, nonce: u64)]
pub struct SubmitIntent<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: pause PDA can be empty/system-owned until the first explicit pause toggle.
    #[account(seeds = [b"pause"], bump)]
    pub pause_state: UncheckedAccount<'info>,

    pub input_mint: Box<Account<'info, Mint>>,
    pub output_mint: Box<Account<'info, Mint>>,

    /// 유저의 input 토큰 계정
    #[account(
        mut,
        associated_token::mint = input_mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Box<Account<'info, TokenAccount>>,

    /// 에스크로 토큰 계정 (IntentAccount PDA가 authority)
    #[account(
        init,
        payer = user,
        associated_token::mint = input_mint,
        associated_token::authority = intent,
    )]
    pub escrow_token_account: Box<Account<'info, TokenAccount>>,

    /// IntentAccount PDA: seeds = [b"intent", user, nonce]
    /// nonce로 동일 유저가 여러 인텐트를 동시에 열 수 있음
    #[account(
        init,
        payer = user,
        space = 8 + IntentAccount::INIT_SPACE,
        seeds = [b"intent", user.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub intent: Box<Account<'info, IntentAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[event]
pub struct IntentSubmitted {
    pub intent: Pubkey,
    pub user: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub input_amount: u64,
    pub min_output_amount: u64,
    pub close_at_slot: u64,
}
