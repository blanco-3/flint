use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct BidAccount {
    /// 입찰한 솔버
    pub solver: Pubkey,
    /// 연결된 IntentAccount PDA
    pub intent: Pubkey,
    /// 솔버가 제시하는 output 수량 (높을수록 유리)
    pub output_amount: u64,
    /// 입찰 제출 슬롯
    pub submitted_at_slot: u64,
    /// 정산 완료 여부
    pub is_settled: bool,
    /// PDA bump
    pub bump: u8,
}
