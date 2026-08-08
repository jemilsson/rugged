//! Win conditions: crew win by slashing the Rugger, Rugger win by parity
//! (Rugger count >= remaining crew count), or task win (crew finishes all
//! tasks before either of the above). The three are evaluated in a fixed
//! priority order and are mutually exclusive by construction — proven over
//! symbolic state in `kani_proofs` for bounded player counts.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WinCondition {
    CrewWinBySlash,
    RuggerWinByParity,
    TaskWin,
}

/// Game state relevant to win-condition evaluation. `rugger_alive` /
/// `crew_alive` count *living, unslashed* players of each faction;
/// `tasks_done` / `tasks_total` describe crew task progress.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GameState {
    pub rugger_alive: u8,
    pub crew_alive: u8,
    pub rugger_was_slashed: bool,
    pub tasks_done: u8,
    pub tasks_total: u8,
}

/// Evaluate win conditions in priority order:
///   1. `CrewWinBySlash` — the Rugger has been slashed (voted out/exposed).
///   2. `RuggerWinByParity` — the Rugger was not slashed and the Rugger
///      count meets or exceeds the remaining crew count (the Rugger can no
///      longer be outvoted).
///   3. `TaskWin` — crew completed every task before either of the above.
/// Returns `None` if no condition is met (game continues).
///
/// Priority order matters for mutual exclusivity: a state where the Rugger
/// was slashed always resolves to `CrewWinBySlash` even if parity or task
/// completion also technically holds, so exactly one outcome (or none) is
/// ever reported for a given state.
pub fn evaluate(state: GameState) -> Option<WinCondition> {
    if state.rugger_was_slashed {
        return Some(WinCondition::CrewWinBySlash);
    }
    if state.rugger_alive > 0 && state.rugger_alive >= state.crew_alive {
        return Some(WinCondition::RuggerWinByParity);
    }
    if state.tasks_total > 0 && state.tasks_done >= state.tasks_total {
        return Some(WinCondition::TaskWin);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> GameState {
        GameState {
            rugger_alive: 1,
            crew_alive: 3,
            rugger_was_slashed: false,
            tasks_done: 0,
            tasks_total: 5,
        }
    }

    #[test]
    fn slash_wins_for_crew_even_if_parity_also_holds() {
        let mut s = base();
        s.rugger_was_slashed = true;
        s.crew_alive = 1; // parity would also trigger, slash takes priority
        assert_eq!(evaluate(s), Some(WinCondition::CrewWinBySlash));
    }

    #[test]
    fn parity_wins_for_rugger_when_not_slashed() {
        let mut s = base();
        s.crew_alive = 1;
        assert_eq!(evaluate(s), Some(WinCondition::RuggerWinByParity));
    }

    #[test]
    fn dead_rugger_never_wins_by_parity() {
        let mut s = base();
        s.rugger_alive = 0;
        s.crew_alive = 0;
        assert_eq!(evaluate(s), None);
    }

    #[test]
    fn task_win_when_crew_finishes_first() {
        let mut s = base();
        s.tasks_done = 5;
        assert_eq!(evaluate(s), Some(WinCondition::TaskWin));
    }

    #[test]
    fn no_winner_mid_game() {
        assert_eq!(evaluate(base()), None);
    }

    #[test]
    fn zero_total_tasks_never_triggers_task_win() {
        let mut s = base();
        s.tasks_total = 0;
        s.tasks_done = 0;
        assert_eq!(evaluate(s), None);
    }
}
