use anchor_lang::prelude::*;

#[error_code]
pub enum FlintError {
    #[msg("수량은 0보다 커야 합니다")]
    ZeroAmount,

    #[msg("인텐트가 Open 상태가 아닙니다")]
    IntentNotOpen,

    #[msg("경매 창이 닫혔습니다")]
    AuctionClosed,

    #[msg("경매 창이 아직 열려 있습니다")]
    AuctionStillOpen,

    #[msg("경매 창이 아직 열려 있어 취소 불가합니다")]
    AuctionWindowStillOpen,

    #[msg("입찰 금액이 최소 output 미만입니다")]
    BidBelowMinimum,

    #[msg("입찰 금액이 현재 최고가 이하입니다")]
    BidNotHigherThanBest,

    #[msg("입찰이 없습니다")]
    NoBidsReceived,

    #[msg("낙찰 입찰이 아닙니다")]
    NotWinningBid,

    #[msg("이미 정산된 입찰입니다")]
    AlreadySettled,

    #[msg("이미 입찰이 있어 취소 불가합니다")]
    HasActiveBid,

    #[msg("담보금이 최소 요건에 미달합니다")]
    InsufficientStake,

    #[msg("솔버가 이미 등록되어 있습니다")]
    SolverAlreadyRegistered,

    #[msg("경매가 아직 종료되지 않았습니다")]
    AuctionNotYetClosed,

    #[msg("이미 정산된 입찰은 슬래싱할 수 없습니다")]
    BidAlreadySettled,

    #[msg("슬래싱 조건이 충족되지 않았습니다")]
    SlashConditionNotMet,

    #[msg("refund grace period가 아직 지나지 않았습니다")]
    RefundGracePeriodNotElapsed,
}
