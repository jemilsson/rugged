/// <reference types="vite/client" />

// Dependency-light: only web3.js types are referenced, and only where a
// consumer already has the package. This file compiles standalone.
import type { Connection, SendOptions, Transaction, VersionedTransaction } from '@solana/web3.js';

export type ClusterName = 'litesvm' | 'devnet' | 'mainnet';

export interface ClusterEnv {
  name: ClusterName;
  /** Base Solana RPC endpoint (devnet/mainnet cluster, or the litesvm shim). */
  baseRpc: string;
  /** MagicBlock Ephemeral Rollup RPC endpoint. Absent for litesvm (no ER shim yet). */
  erRpc?: string;
  /** Anchor program id, sourced from env so it is never hardcoded twice. */
  programId: string;
  ws?: string;
}

const DEFAULT_PROGRAM_ID: Record<ClusterName, string> = {
  // litesvm and devnet share the dev deploy key; override via VITE_PROGRAM_ID.
  litesvm: '11111111111111111111111111111111111111111',
  devnet: '11111111111111111111111111111111111111111',
  mainnet: '11111111111111111111111111111111111111111',
};

function programIdFor(name: ClusterName): string {
  const override = import.meta.env.VITE_PROGRAM_ID as string | undefined;
  return override && override.length > 0 ? override : DEFAULT_PROGRAM_ID[name];
}

function buildCluster(name: ClusterName): ClusterEnv {
  switch (name) {
    case 'litesvm':
      // In-process shim: a demo host serves RPC over LiteSVM at /rpc.
      // No ER hop in this mode; sendGameTx targets baseRpc directly.
      return { name, baseRpc: '/rpc', programId: programIdFor(name) };
    case 'devnet':
      return {
        name,
        baseRpc: 'https://api.devnet.solana.com',
        erRpc: 'https://devnet.magicblock.app/',
        programId: programIdFor(name),
      };
    case 'mainnet':
      return {
        name,
        baseRpc: 'https://api.mainnet-beta.solana.com',
        // Single global mainnet ER router; MagicBlock resolves the nearest
        // region behind this hostname, so no per-region config here.
        erRpc: 'https://as.magicblock.app',
        programId: programIdFor(name),
      };
  }
}

/**
 * Build the active cluster environment. Defaults to VITE_CLUSTER, falling
 * back to 'devnet' when unset; VITE_PROGRAM_ID always overrides the
 * per-cluster default program id so it is configured in exactly one place.
 */
export function makeCluster(name?: ClusterName): ClusterEnv {
  const resolved = name ?? ((import.meta.env.VITE_CLUSTER as ClusterName | undefined) || 'devnet');
  return buildCluster(resolved);
}

/**
 * Send a game transaction against the fastest available endpoint: the
 * Ephemeral Rollup when configured, else the base RPC. ER sends skip
 * preflight since the ER validator re-simulates internally; the caller is
 * responsible for constructing `connection` against `cluster.erRpc ??
 * cluster.baseRpc` (this helper only chooses the send options).
 */
export async function sendGameTx(
  cluster: ClusterEnv,
  connection: Connection,
  tx: Transaction | VersionedTransaction,
): Promise<string> {
  const opts: SendOptions = { skipPreflight: Boolean(cluster.erRpc) };
  return connection.sendRawTransaction(tx.serialize(), opts);
}
