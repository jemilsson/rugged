# Rugged

Among Us-style social deduction on Solana, built for the MagicBlock Blitz V7
hackathon. Four to six players join a lobby under a unique 3-5 character
memecoin ticker. One is secretly the Rugger. Crew moves between rooms,
finds the Rugger before it rugs (kills) them down to parity, and votes out
suspects at emergency meetings. Gameplay runs on a MagicBlock Ephemeral
Rollup for near-instant moves and actions; the game settles back to Solana
base layer at game end.

## How a round works

1. **Lobby** — players call `join` on base layer with their ticker.
2. **Role assignment** — once 4-6 players are in, `assign_roles` commits
   each player's hidden role (`hash(role || salt)`) and marks one player as
   the Rugger. See "Design notes" below on why this is commit-reveal, not a
   TEE, for the MVP.
3. **Delegate** — the game account delegates to the Ephemeral Rollup.
4. **Play** — `move_player`, `rug`, `call_meeting`, `vote`, and
   `resolve_meeting` all run on the ER at ~10-50ms latency.
5. **End** — `end_game` commits final state and undelegates back to base
   layer once the crew slashes the Rugger, or the Rugger reaches parity.

## Repo layout

```
programs/rugged/     Anchor program (Rust): instructions, accounts, errors
app/                 Vite + TypeScript web client, dual-connection stubs
flake.nix            Nix dev shell + cargo-check flake check
Anchor.toml           Anchor workspace config
```

## Build and test

Everything goes through Nix:

```
nix develop                  # dev shell: rustc, cargo, nodejs
nix flake check              # runs cargo check over the workspace (crane)
```

Solana CLI and Anchor CLI (`avm`) are not pinned in the flake — install them
per MagicBlock's own setup docs (they are not reliably packaged in
nixpkgs). The dev shell covers everything `cargo check` needs.

For the web client:

```
nix develop -c bash -c 'cd app && npm install && npm run typecheck'
```

## Design notes / MVP scope

- **Hidden roles**: this MVP uses commit-reveal (a hash of role + salt
  posted on chain at `assign_roles`, revealed at `end_game`) rather than a
  TEE-backed Private Ephemeral Rollup. A PER would delegate a permission
  account alongside the Game/Player accounts so only the Rugger's own
  client could ever read its role plaintext — documented as the stretch
  goal, not built, given the one-day deadline.
- **Randomness**: `assign_roles` currently derives the Rugger index from
  the current slot as a placeholder. Swapping in MagicBlock VRF (request +
  callback) is a marked `TODO` in `programs/rugged/src/lib.rs`.
- **Vote tally**: `resolve_meeting` takes a single `slashed` target chosen
  off-chain from client-aggregated votes rather than iterating every
  `Player` account on-chain; a production version would pass all player
  accounts via `remaining_accounts` and tally on-chain.
- **Map**: four fixed rooms (Turbine, Proof of History, Gossip, Gulf
  Stream) with no adjacency graph enforced yet beyond "same room."

## Program instructions

`initialize_game`, `join`, `assign_roles`, `delegate`, `move_player`,
`rug`, `call_meeting`, `vote`, `resolve_meeting`, `end_game`.
