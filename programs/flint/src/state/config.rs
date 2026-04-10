use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ConfigAccount {
    /// 프로그램 관리자
    pub admin: Pubkey,
    /// 솔버 슬래시 권한
    pub slash_authority: Pubkey,
    /// 스테이크 락업 슬롯 수
    pub stake_lockup_slots: u64,
    /// PDA bump
    pub bump: u8,
}
