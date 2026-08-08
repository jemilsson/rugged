//! Kani formal-verification harnesses for rugged-core.
//!
//! Gated behind `#[cfg(kani)]`; compiled only when `cargo kani` drives the
//! build. No anchor/solana-program dependency (this crate never has one),
//! so the harnesses run against the exact production functions in
//! `tally`, `cooldown`, and `win` — no inlined copies needed.
//!
//! Style follows decentgaming-contracts/programs/decent-gaming-core's
//! kani_proofs.rs: small bounded types to keep CBMC's bit-blast tractable,
//! terse `kani::assume` preconditions, `kissat` only where the default
//! solver stalls.
//!
//! Run on-demand:
//!   LOCAL_OK=1 nix build .#checks.x86_64-linux.kani-rugged-core \
//!     --no-link --print-build-logs --max-jobs auto \
//!     --option substituters "" --option builders ""

#[cfg(kani)]
mod proofs {
    use crate::tally::tally_votes;
    use crate::cooldown::{is_rug_ready, next_eligible_slot, slots_remaining};
    use crate::win::{evaluate, GameState, WinCondition};

    // -------------------------------------------------------------------
    // tally: result index is always in range, ties never slash.
    // -------------------------------------------------------------------

    /// A tally over N players either abstains (None) or names a player
    /// index strictly less than N. Bounded to 4 players (kani unrolls the
    /// tally loop over `votes.len()`, so N is fixed by the array length).
    #[kani::proof]
    #[kani::unwind(5)]
    fn proof_tally_result_in_range() {
        const N: usize = 4;
        let mut votes: [Option<usize>; N] = [None; N];
        for slot in votes.iter_mut() {
            let has_vote: bool = kani::any();
            if has_vote {
                let target: usize = kani::any();
                kani::assume(target < N);
                *slot = Some(target);
            }
        }
        let result = tally_votes(&votes);
        if let Some(i) = result {
            assert!(i < N, "tally must never name a player index outside the electorate");
        }
    }

    /// Two candidates, votes split exactly evenly between them (a tie):
    /// the tally must slash no one, regardless of which players cast which
    /// ballot.
    #[kani::proof]
    #[kani::unwind(5)]
    fn proof_tally_tie_never_slashes() {
        const N: usize = 4;
        // Exactly two players vote, one for candidate 0, one for candidate
        // 1; the remaining two abstain. Symbolic over *which* players vote
        // which way, but the vote counts (1-1) are fixed, which is the tie
        // condition under test.
        let voter_a: usize = kani::any();
        let voter_b: usize = kani::any();
        kani::assume(voter_a < N && voter_b < N && voter_a != voter_b);

        let mut votes: [Option<usize>; N] = [None; N];
        votes[voter_a] = Some(0);
        votes[voter_b] = Some(1);

        assert_eq!(tally_votes(&votes), None, "a 1-1 tie must slash no one");
    }

    /// All-abstain (every ballot None) must never slash anyone, for any
    /// electorate size up to 8.
    #[kani::proof]
    #[kani::unwind(9)]
    fn proof_tally_all_abstain_slashes_no_one() {
        const N: usize = 8;
        let votes: [Option<usize>; N] = [None; N];
        assert_eq!(tally_votes(&votes), None);
    }

    // -------------------------------------------------------------------
    // cooldown: checked arithmetic never panics, and the ready predicate
    // agrees with the eligible-slot computation across the full u64 domain.
    // -------------------------------------------------------------------

    /// `next_eligible_slot` / `is_rug_ready` / `slots_remaining` never
    /// panic for any u64 inputs (checked_add + saturating_sub by
    /// construction) and `is_rug_ready` agrees with the eligible-slot
    /// computation exactly.
    #[kani::proof]
    fn proof_cooldown_no_panic_and_consistent() {
        let current: u64 = kani::any();
        let last: u64 = kani::any();
        let cooldown: u64 = kani::any();

        let ready = is_rug_ready(current, last, cooldown);
        let remaining = slots_remaining(current, last, cooldown);

        match next_eligible_slot(last, cooldown) {
            Some(eligible) => {
                assert_eq!(ready, current >= eligible, "ready must match eligible-slot comparison");
                if current >= eligible {
                    assert_eq!(remaining, 0, "remaining must be 0 once ready");
                } else {
                    assert_eq!(remaining, eligible - current, "remaining must count down exactly");
                }
            }
            None => {
                // Overflow: fail-safe direction is "not ready".
                assert!(!ready, "overflow in eligible-slot math must never report ready");
                assert_eq!(remaining, u64::MAX, "overflow must report maximal remaining");
            }
        }
    }

    // -------------------------------------------------------------------
    // win conditions: mutually exclusive over symbolic state, bounded
    // players <= 8.
    // -------------------------------------------------------------------

    /// `evaluate` reports at most one win condition, and each reported
    /// condition's necessary preconditions actually hold — i.e. the three
    /// outcomes are mutually exclusive and never a false positive. Player
    /// counts bounded to <= 8 (kani player-count bound from the task spec).
    #[kani::proof]
    fn proof_win_conditions_mutually_exclusive() {
        let rugger_alive: u8 = kani::any();
        let crew_alive: u8 = kani::any();
        let rugger_was_slashed: bool = kani::any();
        let tasks_done: u8 = kani::any();
        let tasks_total: u8 = kani::any();
        kani::assume(rugger_alive <= 8 && crew_alive <= 8);
        kani::assume(tasks_done <= 8 && tasks_total <= 8);

        let state = GameState {
            rugger_alive,
            crew_alive,
            rugger_was_slashed,
            tasks_done,
            tasks_total,
        };

        // Raw predicates for each condition, independent of priority order.
        let slash_holds = rugger_was_slashed;
        let parity_holds = !rugger_was_slashed && rugger_alive > 0 && rugger_alive >= crew_alive;
        let task_holds = tasks_total > 0 && tasks_done >= tasks_total;

        match evaluate(state) {
            Some(WinCondition::CrewWinBySlash) => {
                assert!(slash_holds, "CrewWinBySlash reported without rugger_was_slashed");
            }
            Some(WinCondition::RuggerWinByParity) => {
                assert!(!slash_holds, "RuggerWinByParity must not co-occur with a slash");
                assert!(parity_holds, "RuggerWinByParity reported without parity holding");
            }
            Some(WinCondition::TaskWin) => {
                assert!(!slash_holds, "TaskWin must not co-occur with a slash");
                assert!(!parity_holds, "TaskWin must not co-occur with rugger parity");
                assert!(task_holds, "TaskWin reported without tasks complete");
            }
            None => {
                assert!(!slash_holds, "no winner but slash_holds is true");
                assert!(!parity_holds, "no winner but parity_holds is true");
                assert!(!task_holds, "no winner but task_holds is true");
            }
        }

        // Mutual exclusivity of the *reported* outcome: exactly zero or one
        // of the three enum variants is ever produced — guaranteed by
        // Option<WinCondition>'s type (a single value), asserted here as a
        // sanity check that the match above is exhaustive over all three.
        let result = evaluate(state);
        let is_slash = matches!(result, Some(WinCondition::CrewWinBySlash));
        let is_parity = matches!(result, Some(WinCondition::RuggerWinByParity));
        let is_task = matches!(result, Some(WinCondition::TaskWin));
        let true_count = is_slash as u8 + is_parity as u8 + is_task as u8;
        assert!(true_count <= 1, "evaluate must never report more than one win condition");
    }
}
