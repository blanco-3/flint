use anchor_lang::prelude::*;

use crate::errors::FlintError;

#[account]
#[derive(InitSpace)]
pub struct PauseState {
    pub is_paused: bool,
    pub bump: u8,
}

pub fn require_not_paused(account_info: &AccountInfo) -> Result<()> {
    if account_info.owner != &crate::ID || account_info.data_is_empty() {
        return Ok(());
    }

    let data = account_info.try_borrow_data()?;
    let mut slice: &[u8] = &data;
    let pause_state = PauseState::try_deserialize(&mut slice)?;
    require!(!pause_state.is_paused, FlintError::ProtocolPaused);
    Ok(())
}
