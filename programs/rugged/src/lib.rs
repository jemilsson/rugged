//! Rugged: Among Us-style social deduction, delegated to a MagicBlock Ephemeral Rollup.
//!
//! ## Design notes (MVP, read before extending)
//!
//! **Randomness**: role assignment uses an on-chain pseudo-random fallback
//! (`logic::pick_rugger_index`), not `ephemeral-vrf-sdk`. A real VRF request
//! needs an oracle queue account and an async callback instruction, which
//! adds a round-trip this MVP's deadline does not afford. The fallback mixes
//! the clock slot/timestamp with a running hash of every player's role
//! commitment (order-dependent, only known once the lobby is full), which is
//! enough to stop a player from predicting the Rugger before committing.
//! Upgrade path: swap `pick_rugger` for `request_randomness` +
//! `consume_randomness` per `skills/magicblock/vrf.md`.
//!
//! **Hidden role**: commit-reveal. Each player submits `hash(role || salt)`
//! computed off-chain in `assign_roles`. `pick_rugger` (authority-gated, run
//! once the lobby is full) is the rugger-authority step: it derives the
//! Rugger index from the mixed seed and flips `is_rugger` / `game.rugger` for
//! that player only. `is_rugger` is the on-chain permission bit `rug()`
//! checks — the simplest sound design available without a TEE, at the cost
//! that `is_rugger` is plaintext and visible to any RPC reader once set (any
//! client can read who the Rugger is by fetching Player accounts). True
//! hidden roles need a Private Ephemeral Rollup permission account gating
//! reads inside a TEE-backed validator (see `skills/magicblock/delegation.md`
//! PER section) — documented here as a design note, not implemented.
//! `reveal_role` at game end lets anyone verify a player's committed role
//! preimage against `role_hash`, which is the auditability the commitment
//! buys even though the assignment itself isn't secret from RPC reads.
//!
//! **Map**: 4 rooms, Gossip is the hub adjacent to the other three; the other
//! three are only adjacent to Gossip. See `logic::is_adjacent`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

declare_id!("RuggedGame11111111111111111111111111111111");

pub const MIN_PLAYERS: u8 = 4;
pub const MAX_PLAYERS: u8 = 6;
pub const MIN_TICKER_LEN: usize = 3;
pub const MAX_TICKER_LEN: usize = 5;
pub const RUG_COOLDOWN_SECS: i64 = 15;

#[ephemeral]
#[program]
pub mod rugged {
    use super::*;

    /// Base layer: create a new lobby.
    pub fn initialize_game(ctx: Context<InitializeGame>, game_id: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.authority = ctx.accounts.authority.key();
        game.game_id = game_id;
        game.state = GameState::Lobby;
        game.player_count = 0;
        game.roles_committed = 0;
        game.rugger = None;
        game.meeting_active = false;
        game.created_at = Clock::get()?.unix_timestamp;
        game.bump = ctx.bumps.game;
        Ok(())
    }

    /// Base layer: a wallet joins the lobby with a unique memecoin ticker.
    /// Uniqueness is enforced by the client (fetch existing Player PDAs,
    /// resolve seeds `["player", game, ticker]`... instead this MVP keys
    /// Player PDAs by authority, so uniqueness of *ticker text* is enforced
    /// here by scanning `remaining_accounts` (other Player PDAs) if
    /// supplied; passing none skips the check (client-side dedupe UX).
    pub fn join(ctx: Context<Join>, ticker: String) -> Result<()> {
        require!(
            ticker.len() >= MIN_TICKER_LEN && ticker.len() <= MAX_TICKER_LEN,
            RuggedError::InvalidTicker
        );

        let game = &mut ctx.accounts.game;
        require!(game.state == GameState::Lobby, RuggedError::GameNotInLobby);
        require!(game.player_count < MAX_PLAYERS, RuggedError::LobbyFull);

        for other in ctx.remaining_accounts {
            if other.owner != &crate::ID {
                continue;
            }
            let data = other.try_borrow_data()?;
            if data.len() < Player::SPACE {
                continue;
            }
            if let Ok(existing) = Player::try_deserialize(&mut &data[..]) {
                if existing.game != game.key() {
                    continue;
                }
                require!(existing.ticker != ticker, RuggedError::DuplicateTicker);
            }
        }

        let player = &mut ctx.accounts.player;
        player.game = game.key();
        player.authority = ctx.accounts.authority.key();
        player.ticker = ticker;
        player.room = Room::Gossip;
        player.alive = true;
        player.role_hash = [0u8; 32];
        player.role_revealed = false;
        player.is_rugger = false;
        player.last_rug_at = 0;
        player.vote = None;
        player.bump = ctx.bumps.player;

        game.player_count = game
            .player_count
            .checked_add(1)
            .ok_or(RuggedError::LobbyFull)?;
        Ok(())
    }

    /// Base layer: a player commits `hash(role_guess || salt)` computed
    /// off-chain. This locks in a preimage `reveal_role` checks later; it
    /// does not itself decide the Rugger (see `pick_rugger`).
    pub fn assign_roles(ctx: Context<AssignRoles>, role_commitment: [u8; 32]) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.state == GameState::Lobby, RuggedError::GameNotInLobby);

        let player = &mut ctx.accounts.player;
        require_keys_eq!(player.game, game.key(), RuggedError::PlayerNotInGame);
        require!(
            player.role_hash == [0u8; 32],
            RuggedError::RoleAlreadyCommitted
        );
        player.role_hash = role_commitment;
        game.roles_committed = game
            .roles_committed
            .checked_add(1)
            .ok_or(RuggedError::LobbyFull)?;
        Ok(())
    }

    /// Base layer: authority-only. Once every joined player has committed a
    /// role hash, pick the Rugger via the pseudo-random fallback described
    /// in the module doc comment. `remaining_accounts` must be every Player
    /// PDA belonging to this game, in any order.
    pub fn pick_rugger(ctx: Context<PickRugger>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.state == GameState::Lobby, RuggedError::GameNotInLobby);
        require!(
            game.player_count >= MIN_PLAYERS,
            RuggedError::NotEnoughPlayers
        );
        require!(
            game.roles_committed == game.player_count,
            RuggedError::RolesNotCommitted
        );
        require!(game.rugger.is_none(), RuggedError::RuggerAlreadyAssigned);
        require_eq!(
            ctx.remaining_accounts.len(),
            game.player_count as usize,
            RuggedError::PlayerNotInGame
        );

        let mut players = Vec::with_capacity(ctx.remaining_accounts.len());
        let mut seen: Vec<Pubkey> = Vec::with_capacity(ctx.remaining_accounts.len());
        for account_info in ctx.remaining_accounts {
            require!(
                account_info.is_writable,
                RuggedError::PlayerAccountNotWritable
            );
            require!(
                !seen.contains(&account_info.key()),
                RuggedError::DuplicatePlayerAccount
            );
            seen.push(account_info.key());
            let player: Account<Player> = Account::try_from(account_info)?;
            require_keys_eq!(player.game, game.key(), RuggedError::PlayerNotInGame);
            players.push((account_info.clone(), player));
        }
        // Sort by Player PDA key so neither the hash seed nor the chosen
        // index depends on the caller-supplied `remaining_accounts` order,
        // which would otherwise let the game authority grind permutations
        // to choose the Rugger.
        players.sort_by_key(|(_, p)| p.key());
        let commitments: Vec<[u8; 32]> = players.iter().map(|(_, p)| p.role_hash).collect();

        let clock = Clock::get()?;
        let seed = logic::rugger_seed(clock.slot, clock.unix_timestamp, &commitments);
        let index = logic::pick_rugger_index(&seed, game.player_count);

        let (account_info, chosen) = &mut players[index as usize];
        chosen.is_rugger = true;
        game.rugger = Some(chosen.authority);
        chosen.exit(&crate::ID)?;
        let _ = account_info;
        Ok(())
    }

    /// Base layer: delegate the Game account to the Ephemeral Rollup so
    /// gameplay instructions run at ER latency.
    pub fn delegate(ctx: Context<DelegateGame>, game_id: u64) -> Result<()> {
        let mut game: Account<Game> = Account::try_from(&ctx.accounts.game)?;
        require_keys_eq!(
            game.authority,
            ctx.accounts.authority.key(),
            RuggedError::NotGameAuthority
        );
        require!(game.rugger.is_some(), RuggedError::RuggerNotAssigned);
        game.state = GameState::InProgress;
        game.exit(&crate::ID)?;

        ctx.accounts.delegate_game(
            &ctx.accounts.payer,
            &[b"game", &game_id.to_le_bytes()],
            DelegateConfig::default(),
        )?;
        Ok(())
    }

    /// Base layer: delegate a single Player PDA to the Ephemeral Rollup.
    /// Every joined player must call this (once per player) before
    /// `move_player`/`rug`/`vote`/`resolve_meeting` write that player's
    /// state on the ER, or those writes hit an undelegated account and
    /// never settle back to base layer at `end_game`.
    pub fn delegate_player(ctx: Context<DelegatePlayer>) -> Result<()> {
        let player: Account<Player> = Account::try_from(&ctx.accounts.player)?;
        require_keys_eq!(
            player.authority,
            ctx.accounts.authority.key(),
            RuggedError::NotYourPlayer
        );
        require_keys_eq!(
            player.game,
            ctx.accounts.game.key(),
            RuggedError::PlayerNotInGame
        );

        ctx.accounts.delegate_player(
            &ctx.accounts.payer,
            &[
                b"player",
                ctx.accounts.game.key.as_ref(),
                ctx.accounts.authority.key.as_ref(),
            ],
            DelegateConfig::default(),
        )?;
        Ok(())
    }

    /// Ephemeral Rollup: move to an adjacent room.
    pub fn move_player(ctx: Context<MovePlayer>, room: Room) -> Result<()> {
        let game = &ctx.accounts.game;
        require!(
            game.state == GameState::InProgress,
            RuggedError::GameNotInProgress
        );
        require!(!game.meeting_active, RuggedError::MeetingIsActive);

        let player = &mut ctx.accounts.player;
        require!(player.alive, RuggedError::PlayerEliminated);
        require!(
            logic::is_adjacent(player.room, room),
            RuggedError::NotAdjacent
        );
        player.room = room;
        Ok(())
    }

    /// Ephemeral Rollup: the Rugger eliminates a player in the same room,
    /// subject to a cooldown. Gated by the `is_rugger` bit set in
    /// `pick_rugger` (the rugger-authority pattern documented above).
    pub fn rug(ctx: Context<Rug>) -> Result<()> {
        let clock = Clock::get()?;
        let game = &ctx.accounts.game;
        require!(
            game.state == GameState::InProgress,
            RuggedError::GameNotInProgress
        );
        require!(!game.meeting_active, RuggedError::MeetingIsActive);

        let rugger = &mut ctx.accounts.rugger;
        let target = &mut ctx.accounts.target;

        require!(rugger.alive, RuggedError::PlayerEliminated);
        require!(rugger.is_rugger, RuggedError::NotTheRugger);
        require!(target.alive, RuggedError::PlayerEliminated);
        require_keys_neq!(rugger.key(), target.key(), RuggedError::CannotTargetSelf);
        require!(rugger.room == target.room, RuggedError::NotAdjacent);
        require!(
            clock.unix_timestamp - rugger.last_rug_at >= RUG_COOLDOWN_SECS,
            RuggedError::RugOnCooldown
        );

        target.alive = false;
        rugger.last_rug_at = clock.unix_timestamp;

        // Win check: crew reduced to parity with the (always-alive-here)
        // Rugger. `remaining_accounts` must be every other Player PDA in the
        // game (target and rugger excluded), matching `pick_rugger` and
        // `resolve_meeting`'s fixed-count convention so an empty list can't
        // be used to force an instant win.
        require_eq!(
            ctx.remaining_accounts.len(),
            game.player_count as usize - 2,
            RuggedError::WrongRemainingAccountsCount
        );
        let mut seen: Vec<Pubkey> = Vec::with_capacity(ctx.remaining_accounts.len());
        let mut alive_crew = 0u8;
        for account_info in ctx.remaining_accounts {
            let other: Account<Player> = Account::try_from(account_info)?;
            require_keys_eq!(other.game, rugger.game, RuggedError::PlayerNotInGame);
            require!(
                !seen.contains(&account_info.key()),
                RuggedError::DuplicatePlayerAccount
            );
            seen.push(account_info.key());
            if other.alive && !other.is_rugger {
                alive_crew += 1;
            }
        }
        if logic::check_win(alive_crew, true) == Some(logic::Winner::Rugger) {
            ctx.accounts.game.state = GameState::Ended;
            ctx.accounts.game.winner = Some(logic::Winner::Rugger);
        }
        Ok(())
    }

    /// Ephemeral Rollup: any living player calls an emergency meeting.
    pub fn call_meeting(ctx: Context<CallMeeting>) -> Result<()> {
        let caller = &ctx.accounts.caller;
        require!(caller.alive, RuggedError::PlayerEliminated);

        let game = &mut ctx.accounts.game;
        require!(!game.meeting_active, RuggedError::MeetingAlreadyActive);
        game.meeting_active = true;
        Ok(())
    }

    /// Ephemeral Rollup: cast (or change) a vote during an active meeting.
    pub fn vote(ctx: Context<Vote>, target: Option<Pubkey>) -> Result<()> {
        let game = &ctx.accounts.game;
        require!(game.meeting_active, RuggedError::NoMeetingActive);

        let voter = &mut ctx.accounts.voter;
        require!(voter.alive, RuggedError::PlayerEliminated);
        voter.vote = target;
        Ok(())
    }

    /// Ephemeral Rollup: tally votes across every living player, slash the
    /// majority target (ties/no-majority slash nobody), close the meeting,
    /// clear ballots, and end the game on a win condition.
    /// `remaining_accounts` must be every Player PDA belonging to this game.
    pub fn resolve_meeting(ctx: Context<ResolveMeeting>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.state == GameState::InProgress,
            RuggedError::GameNotInProgress
        );
        require!(game.meeting_active, RuggedError::NoMeetingActive);
        require_eq!(
            ctx.remaining_accounts.len(),
            game.player_count as usize,
            RuggedError::PlayerNotInGame
        );

        let mut players = Vec::with_capacity(ctx.remaining_accounts.len());
        let mut seen: Vec<Pubkey> = Vec::with_capacity(ctx.remaining_accounts.len());
        for account_info in ctx.remaining_accounts {
            require!(
                account_info.is_writable,
                RuggedError::PlayerAccountNotWritable
            );
            require!(
                !seen.contains(&account_info.key()),
                RuggedError::DuplicatePlayerAccount
            );
            seen.push(account_info.key());
            let player: Account<Player> = Account::try_from(account_info)?;
            require_keys_eq!(player.game, game.key(), RuggedError::PlayerNotInGame);
            players.push((account_info.clone(), player));
        }

        let votes: Vec<Option<Pubkey>> = players
            .iter()
            .filter(|(_, p)| p.alive)
            .map(|(_, p)| p.vote)
            .collect();
        let slashed = logic::tally_votes(&votes);

        for (account_info, player) in players.iter_mut() {
            player.vote = None;
            if Some(player.authority) == slashed {
                player.alive = false;
            }
            player.exit(&crate::ID)?;
            let _ = account_info;
        }
        game.meeting_active = false;

        let alive_crew = players
            .iter()
            .filter(|(_, p)| p.alive && !p.is_rugger)
            .count() as u8;
        let rugger_alive = players.iter().any(|(_, p)| p.alive && p.is_rugger);
        if let Some(winner) = logic::check_win(alive_crew, rugger_alive) {
            game.state = GameState::Ended;
            game.winner = Some(winner);
        }
        Ok(())
    }

    /// Reveal a committed role for end-of-game auditability: proves the
    /// preimage the player locked in at `assign_roles` matches the role they
    /// claim. Does not gate gameplay (see module doc comment).
    pub fn reveal_role(ctx: Context<RevealRole>, role: Role, salt: [u8; 32]) -> Result<()> {
        let player = &mut ctx.accounts.player;
        require!(!player.role_revealed, RuggedError::RoleAlreadyRevealed);
        let mut preimage = Vec::with_capacity(1 + 32);
        preimage.push(role as u8);
        preimage.extend_from_slice(&salt);
        let computed = hash(&preimage).to_bytes();
        require!(computed == player.role_hash, RuggedError::RoleRevealMismatch);
        require!(
            (role == Role::Rugger) == player.is_rugger,
            RuggedError::RoleAssignmentMismatch
        );
        player.role_revealed = true;
        Ok(())
    }

    /// Ephemeral Rollup: settle final state and undelegate back to base
    /// layer. `remaining_accounts` must be every delegated Player PDA
    /// belonging to this game so their ER writes settle too (see
    /// `delegate_player`); the Game account is always included.
    pub fn end_game(ctx: Context<EndGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.winner.is_some() || game.state == GameState::Ended,
            RuggedError::GameNotEnded
        );
        game.state = GameState::Ended;

        let mut to_undelegate = vec![ctx.accounts.game.to_account_info()];
        to_undelegate.extend(ctx.remaining_accounts.iter().cloned());

        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&to_undelegate)
        .build_and_invoke()?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Pure game logic (unit-testable without an Anchor/BPF runtime)
// ---------------------------------------------------------------------------

pub mod logic {
    use super::{Pubkey, Room};
    use anchor_lang::solana_program::hash::hash;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Winner {
        Crew,
        Rugger,
    }

    /// Room adjacency: Gossip is the hub, adjacent to the other three; the
    /// other three are only adjacent to Gossip. A room is not "adjacent" to
    /// itself (movement always changes room).
    pub fn is_adjacent(a: Room, b: Room) -> bool {
        if a == b {
            return false;
        }
        a == Room::Gossip || b == Room::Gossip
    }

    /// Mix the clock and every committed role hash into a single seed.
    pub fn rugger_seed(slot: u64, unix_timestamp: i64, commitments: &[[u8; 32]]) -> [u8; 32] {
        let mut bytes = Vec::with_capacity(8 + 8 + commitments.len() * 32);
        bytes.extend_from_slice(&slot.to_le_bytes());
        bytes.extend_from_slice(&unix_timestamp.to_le_bytes());
        for c in commitments {
            bytes.extend_from_slice(c);
        }
        hash(&bytes).to_bytes()
    }

    /// Deterministically pick a Rugger index in `[0, player_count)` from a
    /// 32-byte seed. `player_count` must be > 0.
    pub fn pick_rugger_index(seed: &[u8; 32], player_count: u8) -> u8 {
        let mut acc: u64 = 0;
        for chunk in seed.chunks(8) {
            let mut buf = [0u8; 8];
            buf[..chunk.len()].copy_from_slice(chunk);
            acc ^= u64::from_le_bytes(buf);
        }
        (acc % player_count as u64) as u8
    }

    /// Majority vote: `None` in `votes` is a skip and never wins. Ties, no
    /// votes, or a skip-majority all resolve to "slash nobody" (`None`).
    pub fn tally_votes(votes: &[Option<Pubkey>]) -> Option<Pubkey> {
        let mut counts: Vec<(Pubkey, u32)> = Vec::new();
        for v in votes.iter().flatten() {
            match counts.iter_mut().find(|(k, _)| k == v) {
                Some((_, n)) => *n += 1,
                None => counts.push((*v, 1)),
            }
        }
        let max = counts.iter().map(|(_, n)| *n).max()?;
        let mut leaders = counts.iter().filter(|(_, n)| *n == max);
        let first = leaders.next()?;
        if leaders.next().is_some() {
            return None; // tie
        }
        Some(first.0)
    }

    /// Crew wins once the Rugger is dead; the Rugger wins once alive crew
    /// count reaches parity with the (always-one) Rugger, i.e. <= 1 alive
    /// crew remain while the Rugger still lives.
    pub fn check_win(alive_crew: u8, rugger_alive: bool) -> Option<Winner> {
        if !rugger_alive {
            return Some(Winner::Crew);
        }
        if alive_crew <= 1 {
            return Some(Winner::Rugger);
        }
        None
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn gossip_is_adjacent_to_every_other_room() {
            assert!(is_adjacent(Room::Turbine, Room::Gossip));
            assert!(is_adjacent(Room::Gossip, Room::ProofOfHistory));
            assert!(is_adjacent(Room::Gossip, Room::GulfStream));
        }

        #[test]
        fn spoke_rooms_are_not_adjacent_to_each_other() {
            assert!(!is_adjacent(Room::Turbine, Room::ProofOfHistory));
            assert!(!is_adjacent(Room::Turbine, Room::GulfStream));
            assert!(!is_adjacent(Room::ProofOfHistory, Room::GulfStream));
        }

        #[test]
        fn a_room_is_not_adjacent_to_itself() {
            assert!(!is_adjacent(Room::Gossip, Room::Gossip));
            assert!(!is_adjacent(Room::Turbine, Room::Turbine));
        }

        #[test]
        fn pick_rugger_index_stays_in_range_across_many_seeds() {
            for slot in 0..200u64 {
                let commitments = vec![[slot as u8; 32], [(slot + 1) as u8; 32]];
                let seed = rugger_seed(slot, slot as i64 * 7, &commitments);
                let idx = pick_rugger_index(&seed, 5);
                assert!(idx < 5);
            }
        }

        #[test]
        fn pick_rugger_index_is_deterministic_for_same_seed() {
            let commitments = vec![[1u8; 32], [2u8; 32], [3u8; 32]];
            let seed = rugger_seed(42, 1000, &commitments);
            assert_eq!(pick_rugger_index(&seed, 6), pick_rugger_index(&seed, 6));
        }

        #[test]
        fn different_commitments_can_change_the_pick() {
            let a = rugger_seed(42, 1000, &[[1u8; 32], [2u8; 32]]);
            let b = rugger_seed(42, 1000, &[[1u8; 32], [9u8; 32]]);
            assert_ne!(a, b);
        }

        fn pk(byte: u8) -> Pubkey {
            Pubkey::new_from_array([byte; 32])
        }

        #[test]
        fn tally_votes_picks_the_clear_majority() {
            let votes = vec![Some(pk(1)), Some(pk(1)), Some(pk(2))];
            assert_eq!(tally_votes(&votes), Some(pk(1)));
        }

        #[test]
        fn tally_votes_ties_slash_nobody() {
            let votes = vec![Some(pk(1)), Some(pk(2))];
            assert_eq!(tally_votes(&votes), None);
        }

        #[test]
        fn tally_votes_all_skip_slashes_nobody() {
            let votes = vec![None, None, None];
            assert_eq!(tally_votes(&votes), None);
        }

        #[test]
        fn tally_votes_empty_slashes_nobody() {
            let votes: Vec<Option<Pubkey>> = vec![];
            assert_eq!(tally_votes(&votes), None);
        }

        #[test]
        fn skips_do_not_count_toward_a_majority() {
            let votes = vec![Some(pk(1)), None, None];
            assert_eq!(tally_votes(&votes), Some(pk(1)));
        }

        #[test]
        fn check_win_crew_wins_when_rugger_dead() {
            assert_eq!(check_win(3, false), Some(Winner::Crew));
            assert_eq!(check_win(0, false), Some(Winner::Crew));
        }

        #[test]
        fn check_win_rugger_wins_at_parity() {
            assert_eq!(check_win(1, true), Some(Winner::Rugger));
            assert_eq!(check_win(0, true), Some(Winner::Rugger));
        }

        #[test]
        fn check_win_no_winner_mid_game() {
            assert_eq!(check_win(2, true), None);
            assert_eq!(check_win(3, true), None);
        }
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[account]
pub struct Game {
    pub authority: Pubkey,
    pub game_id: u64,
    pub state: GameState,
    pub player_count: u8,
    pub roles_committed: u8,
    pub rugger: Option<Pubkey>,
    pub meeting_active: bool,
    pub winner: Option<logic::Winner>,
    pub created_at: i64,
    pub bump: u8,
}

impl Game {
    pub const SPACE: usize = 8 + 32 + 8 + 1 + 1 + 1 + (1 + 32) + 1 + (1 + 1) + 8 + 1;
}

#[account]
pub struct Player {
    pub game: Pubkey,
    pub authority: Pubkey,
    pub ticker: String, // 3-5 chars, max-length reserved below
    pub room: Room,
    pub alive: bool,
    pub role_hash: [u8; 32],
    pub role_revealed: bool,
    pub is_rugger: bool,
    pub last_rug_at: i64,
    pub vote: Option<Pubkey>,
    pub bump: u8,
}

impl Player {
    pub const SPACE: usize =
        8 + 32 + 32 + (4 + MAX_TICKER_LEN) + 1 + 1 + 32 + 1 + 1 + 8 + (1 + 32) + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum GameState {
    Lobby,
    InProgress,
    Ended,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Room {
    Turbine,
    ProofOfHistory,
    Gossip,
    GulfStream,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    Crew,
    Rugger,
}

impl AnchorSerialize for logic::Winner {
    fn serialize<W: std::io::Write>(&self, writer: &mut W) -> std::io::Result<()> {
        let tag: u8 = match self {
            logic::Winner::Crew => 0,
            logic::Winner::Rugger => 1,
        };
        tag.serialize(writer)
    }
}

impl AnchorDeserialize for logic::Winner {
    fn deserialize_reader<R: std::io::Read>(reader: &mut R) -> std::io::Result<Self> {
        let tag = u8::deserialize_reader(reader)?;
        match tag {
            0 => Ok(logic::Winner::Crew),
            1 => Ok(logic::Winner::Rugger),
            _ => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "invalid Winner tag",
            )),
        }
    }
}

// ---------------------------------------------------------------------------
// Instruction contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct InitializeGame<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = Game::SPACE,
        seeds = [b"game", &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Join<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(
        init,
        payer = authority,
        space = Player::SPACE,
        seeds = [b"player", game.key().as_ref(), authority.key().as_ref()],
        bump
    )]
    pub player: Account<'info, Player>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AssignRoles<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut, has_one = authority @ RuggedError::NotYourPlayer)]
    pub player: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct PickRugger<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ RuggedError::NotGameAuthority)]
    pub game: Account<'info, Game>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DelegateGame<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Must match `Game::authority`; checked in the instruction body since
    /// `game` below is an untyped `AccountInfo` (required by `#[delegate]`).
    pub authority: Signer<'info>,
    /// CHECK: delegated PDA, seeds validated against the Game account below.
    #[account(mut, del, seeds = [b"game", &game_id.to_le_bytes()], bump)]
    pub game: AccountInfo<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegatePlayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,
    /// CHECK: read-only, used only to derive the Player PDA's seeds.
    pub game: AccountInfo<'info>,
    /// CHECK: delegated PDA, seeds validated against `game`/`authority` above.
    #[account(mut, del, seeds = [b"player", game.key().as_ref(), authority.key().as_ref()], bump)]
    pub player: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct MovePlayer<'info> {
    pub authority: Signer<'info>,
    pub game: Account<'info, Game>,
    #[account(
        mut,
        has_one = authority @ RuggedError::NotYourPlayer,
        has_one = game @ RuggedError::PlayerNotInGame
    )]
    pub player: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct Rug<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        has_one = authority @ RuggedError::NotYourPlayer,
        has_one = game @ RuggedError::PlayerNotInGame
    )]
    pub rugger: Account<'info, Player>,
    #[account(mut, has_one = game @ RuggedError::PlayerNotInGame)]
    pub target: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct CallMeeting<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(
        has_one = authority @ RuggedError::NotYourPlayer,
        has_one = game @ RuggedError::PlayerNotInGame
    )]
    pub caller: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    pub authority: Signer<'info>,
    pub game: Account<'info, Game>,
    #[account(
        mut,
        has_one = authority @ RuggedError::NotYourPlayer,
        has_one = game @ RuggedError::PlayerNotInGame
    )]
    pub voter: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct ResolveMeeting<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ RuggedError::NotGameAuthority)]
    pub game: Account<'info, Game>,
}

#[derive(Accounts)]
pub struct RevealRole<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ RuggedError::NotYourPlayer)]
    pub player: Account<'info, Player>,
}

#[commit]
#[derive(Accounts)]
pub struct EndGame<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, has_one = authority @ RuggedError::NotGameAuthority)]
    pub game: Account<'info, Game>,
    /// CHECK: authority check performed via `has_one` on `game`.
    pub authority: UncheckedAccount<'info>,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum RuggedError {
    #[msg("Ticker must be 3-5 characters")]
    InvalidTicker,
    #[msg("Ticker is already taken in this game")]
    DuplicateTicker,
    #[msg("Game is not accepting new players")]
    GameNotInLobby,
    #[msg("Lobby is full")]
    LobbyFull,
    #[msg("Not enough players to start")]
    NotEnoughPlayers,
    #[msg("Player does not belong to this game")]
    PlayerNotInGame,
    #[msg("Player has been eliminated")]
    PlayerEliminated,
    #[msg("Caller is not the Rugger")]
    NotTheRugger,
    #[msg("Target is not in an adjacent room")]
    NotAdjacent,
    #[msg("Rug is on cooldown")]
    RugOnCooldown,
    #[msg("Cannot target yourself")]
    CannotTargetSelf,
    #[msg("No meeting is active")]
    NoMeetingActive,
    #[msg("A meeting is already active")]
    MeetingAlreadyActive,
    #[msg("Signer does not control this player")]
    NotYourPlayer,
    #[msg("Signer is not the game authority")]
    NotGameAuthority,
    #[msg("Player already committed a role hash")]
    RoleAlreadyCommitted,
    #[msg("Not every player has committed a role hash yet")]
    RolesNotCommitted,
    #[msg("Rugger has already been assigned")]
    RuggerAlreadyAssigned,
    #[msg("Rugger has not been assigned yet")]
    RuggerNotAssigned,
    #[msg("remaining_accounts must list every other player in the game")]
    WrongRemainingAccountsCount,
    #[msg("remaining_accounts contains a duplicate player")]
    DuplicatePlayerAccount,
    #[msg("remaining_accounts contains a non-writable player account")]
    PlayerAccountNotWritable,
    #[msg("Game is not in progress")]
    GameNotInProgress,
    #[msg("A meeting is active; gameplay is paused")]
    MeetingIsActive,
    #[msg("Revealed role does not match the assigned Rugger status")]
    RoleAssignmentMismatch,
    #[msg("Game has not ended yet")]
    GameNotEnded,
    #[msg("Role has already been revealed")]
    RoleAlreadyRevealed,
    #[msg("Revealed role does not match the committed hash")]
    RoleRevealMismatch,
}
