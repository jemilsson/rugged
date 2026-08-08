//! Rugged: Among Us-style social deduction, delegated to a MagicBlock Ephemeral Rollup.
//!
//! MVP scaffold: compile-ready instruction stubs and account structs matching
//! the game design. Instruction bodies hold minimal state transitions plus
//! `// TODO` markers where full game logic (VRF, PER/TEE role privacy) lands.
//!
//! Design note (stretch, not implemented in this MVP): true hidden roles
//! would use a TEE-backed Private Ephemeral Rollup (PER) permission account
//! so only the Rugger's client can ever read its own role plaintext. This
//! MVP instead uses commit-reveal: each player submits `hash(role || salt)`
//! at role assignment, and the role is only revealed on `end_game`.

use anchor_lang::prelude::*;
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
        game.rugger = None;
        game.meeting_active = false;
        game.created_at = Clock::get()?.unix_timestamp;
        game.bump = ctx.bumps.game;
        Ok(())
    }

    /// Base layer: a wallet joins the lobby with a unique memecoin ticker.
    pub fn join(ctx: Context<Join>, ticker: String) -> Result<()> {
        require!(
            ticker.len() >= MIN_TICKER_LEN && ticker.len() <= MAX_TICKER_LEN,
            RuggedError::InvalidTicker
        );

        let game = &mut ctx.accounts.game;
        require!(game.state == GameState::Lobby, RuggedError::GameNotInLobby);
        require!(game.player_count < MAX_PLAYERS, RuggedError::LobbyFull);

        let player = &mut ctx.accounts.player;
        player.game = game.key();
        player.authority = ctx.accounts.authority.key();
        player.ticker = ticker;
        player.room = Room::Turbine;
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

    /// Base layer: once the lobby is full, commit each player's hidden role
    /// (hash of role + salt, computed client-side) and pick the Rugger.
    ///
    /// TODO: replace the slot-derived index with a MagicBlock VRF request /
    /// callback (see skills/magicblock/vrf.md) before this leaves MVP status.
    pub fn assign_roles(ctx: Context<AssignRoles>, role_commitment: [u8; 32]) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.state == GameState::Lobby, RuggedError::GameNotInLobby);
        require!(
            game.player_count >= MIN_PLAYERS,
            RuggedError::NotEnoughPlayers
        );

        let player = &mut ctx.accounts.player;
        require_keys_eq!(player.game, game.key(), RuggedError::PlayerNotInGame);
        player.role_hash = role_commitment;

        // TODO(VRF): swap for verifiable randomness. Placeholder keeps the
        // program compiling and the instruction shape stable.
        let clock = Clock::get()?;
        if game.rugger.is_none() {
            let pseudo_index = (clock.slot % game.player_count as u64) as u8;
            if pseudo_index == 0 {
                game.rugger = Some(player.authority);
                player.is_rugger = true;
            }
        }
        Ok(())
    }

    /// Base layer: delegate the Game account to the Ephemeral Rollup so
    /// gameplay instructions run at ER latency.
    pub fn delegate(ctx: Context<DelegateGame>, game_id: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.state = GameState::InProgress;

        ctx.accounts.delegate_game(
            &ctx.accounts.payer,
            &[b"game", &game_id.to_le_bytes()],
            DelegateConfig::default(),
        )?;
        Ok(())
    }

    /// Ephemeral Rollup: move to an adjacent room.
    pub fn move_player(ctx: Context<MovePlayer>, room: Room) -> Result<()> {
        let player = &mut ctx.accounts.player;
        require!(player.alive, RuggedError::PlayerEliminated);
        player.room = room;
        Ok(())
    }

    /// Ephemeral Rollup: the Rugger eliminates an adjacent player, subject
    /// to a cooldown.
    pub fn rug(ctx: Context<Rug>) -> Result<()> {
        let clock = Clock::get()?;
        let rugger = &mut ctx.accounts.rugger;
        let target = &mut ctx.accounts.target;

        require!(rugger.alive, RuggedError::PlayerEliminated);
        require!(rugger.is_rugger, RuggedError::NotTheRugger);
        require!(target.alive, RuggedError::PlayerEliminated);
        require!(rugger.room == target.room, RuggedError::NotAdjacent);
        require!(
            clock.unix_timestamp - rugger.last_rug_at >= RUG_COOLDOWN_SECS,
            RuggedError::RugOnCooldown
        );

        target.alive = false;
        rugger.last_rug_at = clock.unix_timestamp;
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

    /// Ephemeral Rollup: tally votes, slash the majority target, close the
    /// meeting, and check win conditions.
    ///
    /// TODO: full tally requires iterating all Player accounts, passed via
    /// `remaining_accounts` in the client. Stubbed here as a single-target
    /// resolution to keep the instruction signature stable.
    pub fn resolve_meeting(ctx: Context<ResolveMeeting>, slashed: Option<Pubkey>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.meeting_active, RuggedError::NoMeetingActive);
        game.meeting_active = false;

        if let Some(target_key) = slashed {
            let target = &mut ctx.accounts.target;
            require_keys_eq!(target.authority, target_key, RuggedError::PlayerNotInGame);
            target.alive = false;

            if target.is_rugger {
                game.state = GameState::Ended;
            }
        }
        // TODO: also end the game when crew count reaches parity with the Rugger.
        Ok(())
    }

    /// Ephemeral Rollup: settle final state and undelegate back to base layer.
    pub fn end_game(ctx: Context<EndGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.state = GameState::Ended;

        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.game.to_account_info()])
        .build_and_invoke()?;
        Ok(())
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
    pub rugger: Option<Pubkey>,
    pub meeting_active: bool,
    pub created_at: i64,
    pub bump: u8,
}

impl Game {
    pub const SPACE: usize = 8 + 32 + 8 + 1 + 1 + (1 + 32) + 1 + 8 + 1;
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
    #[account(mut, has_one = authority @ RuggedError::NotGameAuthority)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub player: Account<'info, Player>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DelegateGame<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: delegated PDA, seeds validated against the Game account below.
    #[account(mut, del, seeds = [b"game", &game_id.to_le_bytes()], bump)]
    pub game: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct MovePlayer<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ RuggedError::NotYourPlayer)]
    pub player: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct Rug<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ RuggedError::NotYourPlayer)]
    pub rugger: Account<'info, Player>,
    #[account(mut)]
    pub target: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct CallMeeting<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(has_one = authority @ RuggedError::NotYourPlayer)]
    pub caller: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    pub authority: Signer<'info>,
    pub game: Account<'info, Game>,
    #[account(mut, has_one = authority @ RuggedError::NotYourPlayer)]
    pub voter: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct ResolveMeeting<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ RuggedError::NotGameAuthority)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub target: Account<'info, Player>,
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
    #[msg("No meeting is active")]
    NoMeetingActive,
    #[msg("A meeting is already active")]
    MeetingAlreadyActive,
    #[msg("Signer does not control this player")]
    NotYourPlayer,
    #[msg("Signer is not the game authority")]
    NotGameAuthority,
}
