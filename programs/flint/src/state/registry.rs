use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct SolverRegistryAccount {
    /// 솔버 지갑 주소
    pub solver: Pubkey,
    /// 담보금 (lamports) — 불이행 시 슬래싱
    pub stake_amount: u64,
    /// 누적 입찰 횟수
    pub total_bids: u64,
    /// 누적 체결 횟수
    pub total_fills: u64,
    /// 현재 winning bid로 잡혀 있는 활성 인텐트 수
    pub active_winning_bids: u64,
    /// 레퓨테이션 점수 (fills / bids * 1000)
    pub reputation_score: u64,
    /// 등록 슬롯
    pub registered_at_slot: u64,
    /// PDA bump
    pub bump: u8,
}

/// 최소 담보금: 0.1 SOL
pub const MIN_STAKE_LAMPORTS: u64 = 100_000_000;

/// 슬래싱 비율: 20%
pub const SLASH_BPS: u64 = 2000;
