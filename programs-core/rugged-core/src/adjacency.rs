//! Room adjacency for the 4-room map.
//!
//! Rooms: Turbine, PoH, Gossip, GulfStream. Gossip is the hub, adjacent to
//! each of the other three; the other three are only adjacent to Gossip (a
//! star graph, not a ring) — mirrors the design note already documented on
//! `programs/rugged/src/lib.rs`. A player must pass through Gossip to move
//! between any two non-hub rooms, which makes Gossip the natural chokepoint
//! for both social deduction (who was seen where) and rug timing.

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(u8)]
pub enum Room {
    Turbine = 0,
    PoH = 1,
    Gossip = 2,
    GulfStream = 3,
}

impl Room {
    pub const ALL: [Room; 4] = [Room::Turbine, Room::PoH, Room::Gossip, Room::GulfStream];

    pub const fn from_index(i: u8) -> Option<Room> {
        match i {
            0 => Some(Room::Turbine),
            1 => Some(Room::PoH),
            2 => Some(Room::Gossip),
            3 => Some(Room::GulfStream),
            _ => None,
        }
    }

    pub const fn index(self) -> u8 {
        self as u8
    }
}

/// True iff `a` and `b` are directly connected (star graph, Gossip is the
/// hub). A room is not adjacent to itself.
pub const fn is_adjacent(a: Room, b: Room) -> bool {
    match (a, b) {
        (Room::Gossip, Room::Gossip) => false,
        (Room::Gossip, _) | (_, Room::Gossip) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gossip_is_adjacent_to_every_other_room() {
        for &r in &Room::ALL {
            if r != Room::Gossip {
                assert!(is_adjacent(Room::Gossip, r));
                assert!(is_adjacent(r, Room::Gossip));
            }
        }
    }

    #[test]
    fn spoke_rooms_are_not_adjacent_to_each_other() {
        let spokes = [Room::Turbine, Room::PoH, Room::GulfStream];
        for &a in &spokes {
            for &b in &spokes {
                if a != b {
                    assert!(!is_adjacent(a, b), "{a:?} and {b:?} should not be adjacent");
                }
            }
        }
    }

    #[test]
    fn no_room_is_adjacent_to_itself() {
        for &r in &Room::ALL {
            assert!(!is_adjacent(r, r));
        }
    }

    #[test]
    fn adjacency_is_symmetric() {
        for &a in &Room::ALL {
            for &b in &Room::ALL {
                assert_eq!(is_adjacent(a, b), is_adjacent(b, a));
            }
        }
    }

    #[test]
    fn index_round_trips() {
        for &r in &Room::ALL {
            assert_eq!(Room::from_index(r.index()), Some(r));
        }
        assert_eq!(Room::from_index(4), None);
    }
}
