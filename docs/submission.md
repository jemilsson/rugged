# Solana Blitz V7 — Submission Package

Copy-paste source for the submission form. Voice matches `assets/docs/pitch.md`.

---

## Project name

RUGGED

## One-liner

Among Us on Solana. Six tickers, one Rugger.

## Description (~150 words)

RUGGED is a social deduction game for Solana. Six players join as validators keeping the cluster alive; one, drawn by verifiable random function, is the Rugger. The Rugger stalks the map and rugs crewmates one by one. Anyone can call a vote; the crew slashes a suspect or the Rugger rugs them all. Slash the Rugger and the crew wins.

Movement runs in real time on a MagicBlock Ephemeral Rollup, 10-50ms per transaction, fast enough for an on-chain arcade game to feel like a game. Roles stay hidden through commit-reveal today; the production design moves role state into a TEE-backed private Ephemeral Rollup, so not even the chain knows who the Rugger is until the slash. Each player wears a real Solana token as their avatar, pulled straight from on-chain metadata: BONK accusing WIF near a body is the whole game. When the round ends, stakes settle to the base layer in one atomic commit.

## Categories

1. Gaming
2. Social / Multiplayer
3. Infra Showcase

*(Adjust labels to match the actual form dropdown if it differs from these three.)*

## Links

- **Repository:** https://github.com/jemilsson/rugged
- **Live demo:** https://rugged-game.fly.dev — *pending first deploy; do not submit until confirmed live.*
- **Video:** PLACEHOLDER — record and link the demo walkthrough before submission.

## Program addresses

PLACEHOLDER — fill in at devnet deploy.

1. Run `anchor deploy --provider.cluster devnet` (or the project's Nix-driven equivalent).
2. Copy the deployed program ID from the deploy output or `Anchor.toml` under `[programs.devnet]`.
3. Paste it here as:
   - **Program ID (devnet):** `<paste here>`
   - **Cluster:** devnet
   - **Explorer link:** `https://explorer.solana.com/address/<program-id>?cluster=devnet`

## Judging-criteria mapping

- **Creativity** — Among Us reframed as Solana validator lore: votes are governance calls, kills are rugs, avatars are real memecoin tokens read live from on-chain metadata.
- **Technical quality** — core game logic (role resolution, vote tallying, slash conditions) is Kani-verified; CI runs Sec3 X-Ray as a merge gate on the Anchor program, catching known vulnerability classes before deploy.
- **Meaningful Ephemeral Rollup use** — player movement executes on a MagicBlock ER at 10-50ms per transaction, VRF draws the Rugger role, and round settlement commits atomically back to the base layer; the ER is load-bearing for playability, not decorative.

## User-supplied fields checklist

- [ ] Wallet address (submission payout / verification)
- [ ] Telegram handle(s) — all team members
- [ ] Luma event registration confirmed
