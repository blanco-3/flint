use crate::monitor::IntentData;

pub fn calculate_bid(intent: &IntentData) -> u64 {
    intent.min_output_amount.saturating_add(1)
}
