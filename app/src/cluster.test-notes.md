# LiteSVM shim notes

- `litesvm` cluster points `baseRpc` at `/rpc`, a same-origin path, not a URL.
- A demo host process runs LiteSVM in-process and serves the standard Solana
  RPC surface over that path (decent-odds-oracle pattern): no real
  validator, no network hop, no ER hop.
- State resets on every cold start of that host; do not rely on account
  data surviving a redeploy or process restart.
- `litesvm` has no `erRpc`; `sendGameTx` sends to `baseRpc` with
  `skipPreflight: false` (there is no ER re-simulation to defer to).
- Integration must still wire: a dev-only reverse proxy or Vite middleware
  that forwards `/rpc` to the LiteSVM host process, and a way to seed
  program state for demos after each cold start.
- `programId` in litesvm mode should match whatever the LiteSVM host loads;
  set `VITE_PROGRAM_ID` to keep it in sync instead of hardcoding twice.
