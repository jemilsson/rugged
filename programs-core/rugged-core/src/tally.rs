//! Vote tally: majority rule, ties and abstentions slash no one.
//!
//! `votes[i]` is player `i`'s ballot: `Some(target_index)` to accuse, `None`
//! to abstain. The tally counts accusations per target and slashes the
//! strict-majority target only; a tie for the highest count (including a
//! tie at zero, i.e. all-abstain) slashes nobody.

/// Tally votes and return the slashed player's index, or `None` if no
/// player received a strict plurality (tie, or all abstained).
///
/// `votes.len()` is the player count; a `Some(i)` entry must satisfy
/// `i < votes.len()` or it is ignored as an out-of-range ballot (defensive:
/// callers should validate indices before calling, but the tally itself
/// never panics or indexes out of bounds).
pub fn tally_votes(votes: &[Option<usize>]) -> Option<usize> {
    let n = votes.len();
    if n == 0 {
        return None;
    }
    let mut counts = vec![0u32; n];
    for v in votes {
        if let Some(target) = *v {
            if target < n {
                counts[target] += 1;
            }
        }
    }

    let mut best_idx: Option<usize> = None;
    let mut best_count: u32 = 0;
    let mut tied = false;
    for (i, &c) in counts.iter().enumerate() {
        if c == 0 {
            continue;
        }
        match c.cmp(&best_count) {
            std::cmp::Ordering::Greater => {
                best_count = c;
                best_idx = Some(i);
                tied = false;
            }
            std::cmp::Ordering::Equal => {
                tied = true;
            }
            std::cmp::Ordering::Less => {}
        }
    }

    if tied {
        None
    } else {
        best_idx
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unanimous_slashes_the_target() {
        let votes = vec![Some(1), Some(1), Some(1)];
        assert_eq!(tally_votes(&votes), Some(1));
    }

    #[test]
    fn all_abstain_slashes_no_one() {
        let votes = vec![None, None, None, None];
        assert_eq!(tally_votes(&votes), None);
    }

    #[test]
    fn two_way_tie_slashes_no_one() {
        let votes = vec![Some(0), Some(1), None, None];
        assert_eq!(tally_votes(&votes), None);
    }

    #[test]
    fn strict_majority_wins() {
        let votes = vec![Some(2), Some(2), Some(0), None];
        assert_eq!(tally_votes(&votes), Some(2));
    }

    #[test]
    fn out_of_range_ballots_are_ignored() {
        let votes = vec![Some(99), Some(0)];
        assert_eq!(tally_votes(&votes), Some(0));
    }

    #[test]
    fn empty_electorate_slashes_no_one() {
        let votes: Vec<Option<usize>> = vec![];
        assert_eq!(tally_votes(&votes), None);
    }
}
