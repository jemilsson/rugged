// Transaction sending + account fetching for the `rugged` program.
// Base layer (init/join/assign/pick/delegate) vs ER (move/rug/vote/end) per
// skills/magicblock/typescript-setup.md's routing table.
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { baseConnection, erConnection } from "./connection";
import { PROGRAM_ID, decodeGame, decodePlayer, gamePda, type GameAccount, type PlayerAccount } from "./program";

async function send(
  connection: typeof baseConnection,
  wallet: Keypair,
  ixs: TransactionInstruction[],
  skipPreflight: boolean,
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(wallet);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/** Base layer: init/join/assign-roles/pick-rugger/delegate. */
export const sendBase = (wallet: Keypair, ...ixs: TransactionInstruction[]) =>
  send(baseConnection, wallet, ixs, false);

/** Ephemeral rollup: move/rug/meeting/vote/end-game. */
export const sendEr = (wallet: Keypair, ...ixs: TransactionInstruction[]) =>
  send(erConnection, wallet, ixs, true);

export async function fetchGame(gameId: bigint, connection: typeof baseConnection): Promise<GameAccount | null> {
  const [pda] = gamePda(gameId);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  return decodeGame(info.data);
}

export interface PlayerWithPda extends PlayerAccount {
  pda: PublicKey;
}

/** All Player accounts for a game, found by memcmp on the `game` field
 * (offset 8: after the Anchor discriminator, `game: Pubkey` is Player's
 * first field). Works after a page reload with no locally cached list. */
export async function fetchPlayers(game: PublicKey, connection: typeof baseConnection): Promise<PlayerWithPda[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 8, bytes: game.toBase58() } }],
  });
  return accounts
    .map(({ pubkey, account }) => {
      try {
        return { pda: pubkey, ...decodePlayer(account.data) };
      } catch {
        return null; // not a Player account (e.g. the Game account itself never matches offset-8 memcmp, but be defensive)
      }
    })
    .filter((p): p is PlayerWithPda => p !== null);
}
