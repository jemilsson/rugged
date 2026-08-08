//! Rug cooldown arithmetic: slot-based, checked, never panics.
//!
//! The Rugger can only "rug" again after `cooldown_slots` have elapsed since
//! `last_rug_slot`. All arithmetic is checked (`u64`) so a malformed or
//! adversarial slot value can never overflow/panic; callers get `None` and
//! must treat that as "not ready" rather than crash.

/// The slot at which the next rug becomes legal, or `None` on overflow.
pub fn next_eligible_slot(last_rug_slot: u64, cooldown_slots: u64) -> Option<u64> {
    last_rug_slot.checked_add(cooldown_slots)
}

/// Whether a rug is legal at `current_slot`, given the last rug slot and the
/// cooldown length. Overflow in computing the eligible slot is treated as
/// "not ready" (the safe default — never silently permits an early rug).
pub fn is_rug_ready(current_slot: u64, last_rug_slot: u64, cooldown_slots: u64) -> bool {
    match next_eligible_slot(last_rug_slot, cooldown_slots) {
        Some(eligible) => current_slot >= eligible,
        None => false,
    }
}

/// Slots remaining until the next rug is legal (0 if already ready).
/// Overflow in the eligible-slot computation saturates to `u64::MAX`
/// (maximally "not ready"), matching `is_rug_ready`'s fail-safe direction.
pub fn slots_remaining(current_slot: u64, last_rug_slot: u64, cooldown_slots: u64) -> u64 {
    match next_eligible_slot(last_rug_slot, cooldown_slots) {
        Some(eligible) => eligible.saturating_sub(current_slot),
        None => u64::MAX,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_exactly_at_eligible_slot() {
        assert!(is_rug_ready(100, 50, 50));
    }

    #[test]
    fn not_ready_before_eligible_slot() {
        assert!(!is_rug_ready(99, 50, 50));
    }

    #[test]
    fn ready_after_eligible_slot() {
        assert!(is_rug_ready(1000, 50, 50));
    }

    #[test]
    fn overflow_is_treated_as_not_ready() {
        assert!(!is_rug_ready(u64::MAX, u64::MAX, u64::MAX));
        assert_eq!(next_eligible_slot(u64::MAX, 1), None);
    }

    #[test]
    fn slots_remaining_zero_when_ready() {
        assert_eq!(slots_remaining(100, 50, 50), 0);
        assert_eq!(slots_remaining(200, 50, 50), 0);
    }

    #[test]
    fn slots_remaining_counts_down() {
        assert_eq!(slots_remaining(0, 0, 15), 15);
        assert_eq!(slots_remaining(10, 0, 15), 5);
    }
}
