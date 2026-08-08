// Dual-connection setup per skills/magicblock/typescript-setup.md.
// Base layer = Solana devnet, for init/join/delegate/undelegate.
// Ephemeral rollup = MagicBlock devnet ER, for in-game moves/actions.

import { Connection, PublicKey } from "@solana/web3.js";

export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
export const MAGIC_PROGRAM_ID = new PublicKey(
  "Magic11111111111111111111111111111111111111",
);
export const MAGIC_CONTEXT_ID = new PublicKey(
  "MagicContext1111111111111111111111111111111",
);

export const baseConnection = new Connection(
  import.meta.env.VITE_BASE_RPC_ENDPOINT ?? "https://api.devnet.solana.com",
  "confirmed",
);

export const erConnection = new Connection(
  import.meta.env.VITE_ER_RPC_ENDPOINT ?? "https://devnet.magicblock.app/",
  {
    wsEndpoint: import.meta.env.VITE_ER_WS_ENDPOINT ?? "wss://devnet.magicblock.app/",
    commitment: "confirmed",
  },
);

export function isDelegated(owner: PublicKey): boolean {
  return owner.equals(DELEGATION_PROGRAM_ID);
}
