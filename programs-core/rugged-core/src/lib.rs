//! rugged-core: pure game logic for Rugged, dependency-free.
//!
//! No anchor/solana-program dependency, so this crate compiles with a plain
//! `cargo build` and (behind `#[cfg(kani)]`) with `cargo kani`. The on-chain
//! program (`programs/rugged`) owns account plumbing; this crate holds the
//! rules that admit a formal proof or a fast unit test independent of that
//! plumbing: room adjacency, vote tally, rug cooldown arithmetic, and win
//! conditions.

pub mod adjacency;
pub mod cooldown;
pub mod tally;
pub mod win;

#[cfg(kani)]
mod kani_proofs;
