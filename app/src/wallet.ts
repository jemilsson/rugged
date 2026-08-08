// MVP local wallet: a Keypair persisted in localStorage per browser, funded
// by devnet airdrop. Good enough for a hackathon demo where every player
// opens the app in their own browser/tab; a real wallet-adapter integration
// (Phantom etc.) is the documented upgrade path once there's time for it.
import { Keypair } from "@solana/web3.js";
import { baseConnection } from "./connection";

const STORAGE_KEY = "rugged.wallet.secretKey";

export function loadOrCreateWallet(): Keypair {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
    } catch {
      // Fall through and mint a fresh one if storage was corrupted.
    }
  }
  const kp = Keypair.generate();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

/** Airdrop devnet SOL if the wallet balance is low. Best-effort: devnet
 * faucets rate-limit hard, so failures here don't block the UI. */
export async function ensureFunded(wallet: Keypair, minLamports = 0.5e9): Promise<void> {
  const balance = await baseConnection.getBalance(wallet.publicKey);
  if (balance >= minLamports) return;
  try {
    const sig = await baseConnection.requestAirdrop(wallet.publicKey, 1e9);
    await baseConnection.confirmTransaction(sig, "confirmed");
  } catch (err) {
    console.warn("Airdrop failed (devnet faucet may be rate-limited):", err);
  }
}
