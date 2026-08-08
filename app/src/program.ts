// Hand-rolled client for the `rugged` Anchor program.
//
// No Anchor CLI/IDL is available in this environment (see flake.nix comment
// on programs/rugged/Cargo.toml for why `anchor build` is blocked). Rather
// than fight IDL generation under a hackathon deadline, this module builds
// instructions directly: Anchor's discriminator is `sha256("global:<name>")
// [0..8]` and the argument/account layouts are read straight off
// `programs/rugged/src/lib.rs`. Keep this file in sync with lib.rs by hand.
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  DELEGATION_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "./connection";

export const PROGRAM_ID = new PublicKey(
  "RuggedGame11111111111111111111111111111111",
);

// ---------------------------------------------------------------------------
// Discriminators: sha256("global:<snake_case_name>")[0..8], precomputed
// (see app/README or the task history for the node one-liner that made
// these; they never change unless an instruction is renamed).
// ---------------------------------------------------------------------------
const DISC = {
  initialize_game: [44, 62, 102, 247, 126, 208, 130, 215],
  join: [206, 55, 2, 106, 113, 220, 17, 163],
  assign_roles: [55, 227, 97, 221, 175, 205, 197, 179],
  pick_rugger: [225, 152, 50, 225, 0, 38, 224, 234],
  delegate: [90, 147, 75, 178, 85, 88, 4, 137],
  delegate_player: [235, 159, 245, 102, 161, 199, 254, 89],
  move_player: [17, 58, 68, 221, 186, 117, 140, 231],
  rug: [132, 118, 81, 93, 37, 10, 112, 231],
  call_meeting: [227, 239, 168, 73, 177, 220, 20, 83],
  vote: [227, 110, 155, 23, 136, 126, 172, 25],
  resolve_meeting: [111, 16, 163, 13, 189, 86, 62, 157],
  reveal_role: [180, 50, 92, 136, 182, 242, 69, 183],
  end_game: [224, 135, 245, 99, 67, 175, 121, 252],
} as const;

// ---------------------------------------------------------------------------
// Enums, matching lib.rs declaration order (Borsh encodes enums as u8 tag).
// ---------------------------------------------------------------------------
export enum Room {
  Turbine = 0,
  ProofOfHistory = 1,
  Gossip = 2,
  GulfStream = 3,
}
export const ROOM_NAMES: Record<Room, string> = {
  [Room.Turbine]: "Turbine",
  [Room.ProofOfHistory]: "Proof of History",
  [Room.Gossip]: "Gossip",
  [Room.GulfStream]: "Gulf Stream",
};
export const ADJACENT_TO_GOSSIP = [Room.Turbine, Room.ProofOfHistory, Room.GulfStream];
export function isAdjacent(a: Room, b: Room): boolean {
  if (a === b) return false;
  return a === Room.Gossip || b === Room.Gossip;
}

export enum Role {
  Crew = 0,
  Rugger = 1,
}

export enum GameState {
  Lobby = 0,
  InProgress = 1,
  Ended = 2,
}

export enum Winner {
  Crew = 0,
  Rugger = 1,
}

// ---------------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------------
export function gamePda(gameId: bigint): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(gameId);
  return PublicKey.findProgramAddressSync([Buffer.from("game"), buf], PROGRAM_ID);
}

export function playerPda(game: PublicKey, authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("player"), game.toBuffer(), authority.toBuffer()],
    PROGRAM_ID,
  );
}

// Delegation-program PDAs: the `#[delegate]` macro derives these with the
// exact same seeds server-side when it CPIs into the delegation program, so
// reuse the SDK's own helpers rather than re-deriving by hand.
const delegationBufferPda = (delegated: PublicKey) =>
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram(delegated, PROGRAM_ID);
const delegationRecordPda = delegationRecordPdaFromDelegatedAccount;
const delegationMetadataPda = delegationMetadataPdaFromDelegatedAccount;

// ---------------------------------------------------------------------------
// Borsh helpers (only what this program's args need)
// ---------------------------------------------------------------------------
function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}
function borshString(s: string): Buffer {
  const body = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length);
  return Buffer.concat([len, body]);
}
function optionPubkey(pk: PublicKey | null): Buffer {
  if (!pk) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), pk.toBuffer()]);
}

function ix(name: keyof typeof DISC, keys: TransactionInstruction["keys"], args: Buffer = Buffer.alloc(0)) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data: Buffer.concat([Buffer.from(DISC[name]), args]),
  });
}

const signer = (pubkey: PublicKey, isWritable = false) => ({ pubkey, isSigner: true, isWritable });
const acc = (pubkey: PublicKey, isWritable = false) => ({ pubkey, isSigner: false, isWritable });

// ---------------------------------------------------------------------------
// Base-layer instructions
// ---------------------------------------------------------------------------
export function initializeGameIx(authority: PublicKey, gameId: bigint) {
  const [game] = gamePda(gameId);
  return ix(
    "initialize_game",
    [signer(authority, true), acc(game, true), acc(SystemProgram.programId)],
    u64le(gameId),
  );
}

export function joinIx(authority: PublicKey, game: PublicKey, ticker: string) {
  const [player] = playerPda(game, authority);
  return ix(
    "join",
    [signer(authority, true), acc(game, true), acc(player, true), acc(SystemProgram.programId)],
    borshString(ticker),
  );
}

export function assignRolesIx(
  authority: PublicKey,
  game: PublicKey,
  player: PublicKey,
  roleCommitment: Uint8Array,
) {
  return ix(
    "assign_roles",
    [signer(authority), acc(game, true), acc(player, true)],
    Buffer.from(roleCommitment),
  );
}

export function pickRuggerIx(authority: PublicKey, game: PublicKey, allPlayers: PublicKey[]) {
  return ix(
    "pick_rugger",
    [signer(authority), acc(game, true), ...allPlayers.map((p) => acc(p, true))],
  );
}

export function delegateGameIx(payer: PublicKey, authority: PublicKey, gameId: bigint) {
  const [game] = gamePda(gameId);
  return ix(
    "delegate",
    [
      signer(payer, true),
      signer(authority),
      acc(game, true),
      acc(PROGRAM_ID),
      acc(delegationBufferPda(game), true),
      acc(delegationRecordPda(game), true),
      acc(delegationMetadataPda(game), true),
      acc(DELEGATION_PROGRAM_ID),
      acc(SystemProgram.programId),
    ],
    u64le(gameId),
  );
}

export function delegatePlayerIx(payer: PublicKey, authority: PublicKey, game: PublicKey) {
  const [player] = playerPda(game, authority);
  return ix("delegate_player", [
    signer(payer, true),
    signer(authority),
    acc(game),
    acc(player, true),
    acc(PROGRAM_ID),
    acc(delegationBufferPda(player), true),
    acc(delegationRecordPda(player), true),
    acc(delegationMetadataPda(player), true),
    acc(DELEGATION_PROGRAM_ID),
    acc(SystemProgram.programId),
  ]);
}

// ---------------------------------------------------------------------------
// Ephemeral-rollup instructions
// ---------------------------------------------------------------------------
export function movePlayerIx(authority: PublicKey, game: PublicKey, player: PublicKey, room: Room) {
  return ix(
    "move_player",
    [signer(authority), acc(game), acc(player, true)],
    Buffer.from([room]),
  );
}

export function rugIx(
  authority: PublicKey,
  game: PublicKey,
  rugger: PublicKey,
  target: PublicKey,
  otherPlayers: PublicKey[],
) {
  return ix("rug", [
    signer(authority),
    acc(game, true),
    acc(rugger, true),
    acc(target, true),
    ...otherPlayers.map((p) => acc(p)),
  ]);
}

export function callMeetingIx(authority: PublicKey, game: PublicKey, caller: PublicKey) {
  return ix("call_meeting", [signer(authority), acc(game, true), acc(caller)]);
}

export function voteIx(authority: PublicKey, game: PublicKey, voter: PublicKey, target: PublicKey | null) {
  return ix("vote", [signer(authority), acc(game), acc(voter, true)], optionPubkey(target));
}

export function resolveMeetingIx(authority: PublicKey, game: PublicKey, allPlayers: PublicKey[]) {
  return ix("resolve_meeting", [
    signer(authority),
    acc(game, true),
    ...allPlayers.map((p) => acc(p, true)),
  ]);
}

export function revealRoleIx(authority: PublicKey, player: PublicKey, role: Role, salt: Uint8Array) {
  return ix(
    "reveal_role",
    [signer(authority), acc(player, true)],
    Buffer.concat([Buffer.from([role]), Buffer.from(salt)]),
  );
}

export function endGameIx(payer: PublicKey, game: PublicKey, authority: PublicKey, delegatedPlayers: PublicKey[]) {
  return ix("end_game", [
    signer(payer, true),
    acc(game, true),
    acc(authority),
    acc(MAGIC_CONTEXT_ID, true),
    acc(MAGIC_PROGRAM_ID),
    ...delegatedPlayers.map((p) => acc(p, true)),
  ]);
}

// ---------------------------------------------------------------------------
// Account decoding (manual Borsh reader; mirrors `Game`/`Player` in lib.rs)
// ---------------------------------------------------------------------------
class Reader {
  offset = 8; // skip 8-byte Anchor account discriminator
  constructor(private buf: Buffer) {}
  u8() {
    return this.buf.readUInt8(this.offset++);
  }
  bool() {
    return this.u8() !== 0;
  }
  u64(): bigint {
    const v = this.buf.readBigUInt64LE(this.offset);
    this.offset += 8;
    return v;
  }
  i64(): bigint {
    const v = this.buf.readBigInt64LE(this.offset);
    this.offset += 8;
    return v;
  }
  pubkey(): PublicKey {
    const pk = new PublicKey(this.buf.subarray(this.offset, this.offset + 32));
    this.offset += 32;
    return pk;
  }
  bytes32(): Uint8Array {
    const b = this.buf.subarray(this.offset, this.offset + 32);
    this.offset += 32;
    return new Uint8Array(b);
  }
  string(): string {
    const len = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    const s = this.buf.toString("utf8", this.offset, this.offset + len);
    this.offset += len;
    return s;
  }
  optionPubkey(): PublicKey | null {
    return this.u8() ? this.pubkey() : null;
  }
}

export interface GameAccount {
  authority: PublicKey;
  gameId: bigint;
  state: GameState;
  playerCount: number;
  rolesCommitted: number;
  rugger: PublicKey | null;
  meetingActive: boolean;
  winner: Winner | null;
  createdAt: bigint;
}

export function decodeGame(data: Buffer): GameAccount {
  const r = new Reader(data);
  const authority = r.pubkey();
  const gameId = r.u64();
  const state = r.u8() as GameState;
  const playerCount = r.u8();
  const rolesCommitted = r.u8();
  const rugger = r.optionPubkey();
  const meetingActive = r.bool();
  const winner = r.u8() ? (r.u8() as Winner) : null;
  const createdAt = r.i64();
  return { authority, gameId, state, playerCount, rolesCommitted, rugger, meetingActive, winner, createdAt };
}

export interface PlayerAccount {
  game: PublicKey;
  authority: PublicKey;
  ticker: string;
  room: Room;
  alive: boolean;
  roleHash: Uint8Array;
  roleRevealed: boolean;
  isRugger: boolean;
  lastRugAt: bigint;
  vote: PublicKey | null;
}

export function decodePlayer(data: Buffer): PlayerAccount {
  const r = new Reader(data);
  const game = r.pubkey();
  const authority = r.pubkey();
  const ticker = r.string();
  const room = r.u8() as Room;
  const alive = r.bool();
  const roleHash = r.bytes32();
  const roleRevealed = r.bool();
  const isRugger = r.bool();
  const lastRugAt = r.i64();
  const vote = r.optionPubkey();
  return { game, authority, ticker, room, alive, roleHash, roleRevealed, isRugger, lastRugAt, vote };
}

export function randomSalt(): Uint8Array {
  return Keypair.generate().publicKey.toBytes();
}
