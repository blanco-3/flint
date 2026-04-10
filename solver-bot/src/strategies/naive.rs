use crate::monitor::IntentData;

pub fn calculate_bid(intent: &IntentData) -> u64 {
    // TODO: Integrate Jupiter price data and inventory-aware pricing.
    intent.min_output_amount.saturating_add(1)
}
