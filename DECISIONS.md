# Decisions

## Cluster abstraction (app/src/cluster.ts)

One `ClusterEnv` interface, three factories (`litesvm`, `devnet`, `mainnet`)
behind a single `makeCluster(name?)` entry point.

- The program id comes from `VITE_PROGRAM_ID` when set, else a per-cluster
  default; it is never hardcoded a second time at a call site.
- `litesvm` is an optional local demo mode: an in-process LiteSVM RPC shim
  at `/rpc`, no ER endpoint, state resets on cold start. It is not a
  network cluster and must not be reachable from production builds.
- `devnet` and `mainnet` each carry a base RPC and an ER RPC
  (`erRpc`); `sendGameTx` targets `erRpc ?? baseRpc` and skips preflight
  only when an ER endpoint is in play.
- Cluster selection is env-driven (`VITE_CLUSTER`, default `devnet`), not a
  build-time branch, so the same bundle can target different clusters.
