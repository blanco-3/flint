use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct IntentAccount {
    /// 인텐트를 제출한 유저
    pub user: Pubkey,
    /// 유저가 내는 토큰 민트
    pub input_mint: Pubkey,
    /// 유저가 받고 싶은 토큰 민트
    pub output_mint: Pubkey,
    /// 유저가 내는 토큰 수량
    pub input_amount: u64,
    /// 유저가 받아야 할 최소 수량 (슬리피지 보호)
    pub min_output_amount: u64,
    /// 경매 시작 슬롯
    pub open_at_slot: u64,
    /// 경매 종료 슬롯 (open + AUCTION_WINDOW_SLOTS)
    pub close_at_slot: u64,
    /// 현재 최고 입찰 금액
    pub best_bid_amount: u64,
    /// 현재 최고 입찰 BidAccount PDA
    pub winning_bid: Option<Pubkey>,
    /// 인텐트 상태
    pub status: IntentStatus,
    /// 유저 제공 nonce (PDA seed용, unix timestamp 권장)
    pub nonce: u64,
    /// PDA bump
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum IntentStatus {
    Open,
    Filled,
    Expired,
    Cancelled,
}

/// 경매 창: 20슬롯 (약 8초)
pub const AUCTION_WINDOW_SLOTS: u64 = 20;

/// 미정산 낙찰 환불 grace: 10슬롯
pub const REFUND_GRACE_SLOTS: u64 = 10;
