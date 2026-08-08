# Submission checklist

Ordered runbook from pre-record setup through final submission. Beats
match `docs/demo-script.md`; form fields match `docs/submission.md`.
Check each item in order; don't skip ahead.

## 1. Pre-record setup

- [ ] Program deployed to devnet.
      Verify: `solana program show <PROGRAM_ID> --url devnet`
- [ ] Devnet wallets funded (six players plus deploy authority).
      Verify: `solana balance <WALLET> --url devnet` for each wallet, all > 0
- [ ] `app/.env` points at the devnet ER endpoint.
      Verify: `grep MAGICBLOCK app/.env` shows `https://devnet.magicblock.app/`
- [ ] Client builds and starts clean.
      Verify: `nix develop -c bash -c 'cd app && npm run dev'` then load
      `http://localhost:5173` with no console errors
- [ ] Six browser tabs open side by side (or a 3x2 grid capture), each on
      the local client.
- [ ] Spare tab open on `solana logs --url devnet` or the ER explorer,
      ready for the reveal beat.
- [ ] Screen recorder framed and tested on a 10-second dry run.

## 2. Per-beat playtest (pass/fail)

Each row is a beat from `docs/demo-script.md`. Run the full sequence
once end to end before recording; record pass/fail per beat.

- [ ] **0:00-0:15 Cold open** — lobby screen loads empty, title card
      shows. Pass: title/lobby art renders, no placeholder text visible.
- [ ] **0:15-0:35 Join** — six tabs join with distinct tickers
      (`$RUG`, `$MOON`, `$WAGMI`, `$APE`, `$DEGEN`, `$PUMP`). Pass:
      lobby counter reaches 6/6 and every tab shows all six tickers.
      Verify: `solana logs --url devnet | grep join` shows 6 `join` calls
- [ ] **0:35-0:55 Role assignment + hash reveal** — `assign_roles` fires
      after the sixth join. Pass: explorer tab shows the `assign_roles`
      transaction with a committed hash, no plaintext role visible.
      Verify: `solana confirm -v <ASSIGN_ROLES_SIG> --url devnet`
- [ ] **0:55-1:10 Delegate + first moves** — accounts delegate to the ER,
      players move between rooms. Pass: moves land under 50ms and
      position updates appear in other tabs within one frame.
      Verify: browser devtools network tab shows ER round-trip < 50ms
- [ ] **1:10-1:30 The rug** — Rugger and victim share a room, Rugger
      calls `rug`. Pass: victim tab shows elimination, other tabs show
      "player down."
- [ ] **1:30-1:55 Meeting and vote** — a survivor calls a meeting, tabs
      snap to vote screen, votes cast and tally. Pass: vote counts match
      across all tabs.
- [ ] **1:55-2:15 Slash and resolution** — `resolve_meeting` fires, the
      accused tab shows elimination, win banner shows for the correct
      side. Pass: banner matches the actual accused role (check against
      the reveal in the next beat).
- [ ] **2:15-2:35 Win screen + on-chain reveal** — `end_game` reveals the
      role, explorer tab confirms accounts undelegated. Pass: revealed
      role's hash matches the hash captured at 0:35.
      Verify: `solana confirm -v <END_GAME_SIG> --url devnet`
- [ ] **2:35-2:50 Close** — architecture diagram from the README holds
      on screen. Pass: diagram legible at recording resolution.

## 3. Submission final gates

- [ ] Repository is public and the URL in `docs/submission.md` resolves.
      Verify: `curl -sI https://github.com/jemilsson/rugged | head -1`
      returns `200`
- [ ] `nix flake check` passes on the commit being submitted.
      Verify: `nix flake check`
- [ ] Live demo deployed and reachable.
      Verify: `curl -sI https://rugged-game.fly.dev | head -1` returns `200`
- [ ] Demo video recorded, 2-3 minutes, uploaded, and linked in
      `docs/submission.md`.
      Verify: link in `docs/submission.md` is no longer `PLACEHOLDER`
- [ ] Program ID filled into `docs/submission.md` and matches the
      deployed program.
      Verify: `grep -A1 'Program ID (devnet)' docs/submission.md` matches
      `solana address -k target/deploy/rugged-keypair.json`
- [ ] Explorer link in `docs/submission.md` resolves to the deployed
      program.
      Verify: `curl -sI https://explorer.solana.com/address/<PROGRAM_ID>?cluster=devnet | head -1`
- [ ] User-supplied fields checklist in `docs/submission.md` complete
      (wallet address, Telegram handles, Luma registration).
- [ ] README hero and screenshot images render on GitHub (not broken
      links).
      Verify: open the repo's GitHub page and confirm the top image and
      screenshots section load
- [ ] Final read of `docs/submission.md` for placeholder text.
      Verify: `grep -n PLACEHOLDER docs/submission.md` returns nothing
