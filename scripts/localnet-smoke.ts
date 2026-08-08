// Localnet smoke driver for the rugged program.
//
// Invoked by scripts/localnet-smoke.sh against a running solana-test-validator
// with the program already deployed. Resolves instruction names from the
// built IDL at runtime (rather than hardcoding them disconnected from the
// program) so a renamed or removed instruction fails loudly here instead of
// silently calling the wrong method.
//
// Env vars (set by localnet-smoke.sh):
//   RUGGED_RPC_URL  - JSON-RPC endpoint of the running validator.
//   RUGGED_IDL_PATH - absolute path to target/idl/rugged.json.

import { readFileSync, existsSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const RPC_URL = process.env.RUGGED_RPC_URL ?? "http://127.0.0.1:8899";
const IDL_PATH = process.env.RUGGED_IDL_PATH;

if (!IDL_PATH || !existsSync(IDL_PATH)) {
  console.error(`FATAL: IDL not found at ${IDL_PATH ?? "(unset)"}.`);
  console.error("Build the program first: anchor build");
  process.exit(1);
}

const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));

const snakeToCamel = (s: string): string =>
  s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

// Fail loudly, not silently, if the program's instruction shape drifted.
const requireIx = (name: string): string => {
  const found = idl.instructions?.some((ix: { name: string }) => ix.name === name);
  if (!found) {
    console.error(
      `FATAL: instruction "${name}" not found in IDL ${IDL_PATH}. ` +
        `Program instruction set has drifted from this smoke test.`,
    );
    process.exit(1);
  }
  return snakeToCamel(name);
};

const IX_INITIALIZE_GAME = requireIx("initialize_game");
const IX_JOIN = requireIx("join");
const IX_ASSIGN_ROLES = requireIx("assign_roles");

async function main() {
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");

  const authority = Keypair.generate();
  const player1 = Keypair.generate();
  const player2 = Keypair.generate();

  for (const kp of [authority, player1, player2]) {
    const sig = await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const programId = new PublicKey(idl.address ?? idl.metadata?.address);
  const program = new anchor.Program(idl, provider) as anchor.Program;
  if (program.programId.toBase58() !== programId.toBase58()) {
    // anchor.Program derives programId from idl.address in Anchor 0.30+;
    // this check catches an IDL/program-id mismatch before it manifests as
    // an opaque "account not found" later.
    console.error(
      `FATAL: program id mismatch: IDL says ${programId.toBase58()}, ` +
        `Program resolved ${program.programId.toBase58()}.`,
    );
    process.exit(1);
  }

  const gameId = new anchor.BN(Date.now());
  const [gamePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("game"), gameId.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );

  console.log(`==> ${IX_INITIALIZE_GAME}`);
  await program.methods[IX_INITIALIZE_GAME](gameId)
    .accounts({
      authority: authority.publicKey,
      game: gamePda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  const players = [
    { kp: player1, ticker: "ABC" },
    { kp: player2, ticker: "XYZ" },
  ];
  const playerPdas: PublicKey[] = [];

  for (const { kp, ticker } of players) {
    const [playerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player"), gamePda.toBuffer(), kp.publicKey.toBuffer()],
      program.programId,
    );
    playerPdas.push(playerPda);

    console.log(`==> ${IX_JOIN} (${ticker})`);
    await program.methods[IX_JOIN](ticker)
      .accounts({
        authority: kp.publicKey,
        game: gamePda,
        player: playerPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();
  }

  const gameAccount = await (program.account as any).game.fetch(gamePda);
  if (gameAccount.playerCount !== 2) {
    console.error(`FATAL: expected player_count 2, got ${gameAccount.playerCount}`);
    process.exit(1);
  }

  const roleCommitment = Array.from(
    anchor.web3.Keypair.generate().publicKey.toBytes(),
  ); // stand-in 32-byte commitment; only non-zero-ness is asserted below.

  console.log(`==> ${IX_ASSIGN_ROLES}`);
  await program.methods[IX_ASSIGN_ROLES](roleCommitment)
    .accounts({
      authority: player1.publicKey,
      game: gamePda,
      player: playerPdas[0],
    })
    .signers([player1])
    .rpc();

  const playerAccount = await (program.account as any).player.fetch(playerPdas[0]);
  const roleHash: Buffer = Buffer.from(playerAccount.roleHash);
  const isNonZero = roleHash.some((b) => b !== 0);
  if (!isNonZero) {
    console.error("FATAL: role_hash is all zeros after assign_roles.");
    process.exit(1);
  }

  console.log("==> localnet smoke: initialize_game, join x2, assign_roles all OK");
  console.log(`==> role_hash non-zero: ${roleHash.toString("hex")}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
