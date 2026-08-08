// Rugged client entry point: lobby -> game -> meeting/vote -> win, wired
// against the deployed `rugged` program (see programs/rugged/src/lib.rs).
import { Buffer } from "buffer";
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { PublicKey } from "@solana/web3.js";
import { baseConnection, erConnection } from "./connection";
import { loadOrCreateWallet, ensureFunded } from "./wallet";
import { fetchGame, fetchPlayers, sendBase, sendEr, type PlayerWithPda } from "./client";
import {
  GameState,
  Role,
  Room,
  ROOM_NAMES,
  Winner,
  gamePda,
  isAdjacent,
  playerPda,
  randomSalt,
  type GameAccount,
  initializeGameIx,
  joinIx,
  assignRolesIx,
  pickRuggerIx,
  delegateGameIx,
  delegatePlayerIx,
  movePlayerIx,
  rugIx,
  callMeetingIx,
  voteIx,
  resolveMeetingIx,
  endGameIx,
  PROGRAM_ID,
} from "./program";

const wallet = loadOrCreateWallet();

// --- persisted per-browser session state (survives reload) ---------------
const store = {
  get gameId(): bigint | null {
    const v = localStorage.getItem("rugged.gameId");
    return v ? BigInt(v) : null;
  },
  set gameId(v: bigint | null) {
    if (v === null) localStorage.removeItem("rugged.gameId");
    else localStorage.setItem("rugged.gameId", v.toString());
  },
  get salt(): Uint8Array {
    const gid = store.gameId ?? 0n;
    const key = `rugged.salt.${gid}`;
    const v = localStorage.getItem(key);
    if (v) return Uint8Array.from(JSON.parse(v));
    const salt = randomSalt();
    localStorage.setItem(key, JSON.stringify(Array.from(salt)));
    return salt;
  },
};

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return new Uint8Array(digest);
}

// --- app shell -------------------------------------------------------------
const app = document.getElementById("app")!;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function setStatus(msg: string, isError = false) {
  const el = document.getElementById("status");
  if (el) {
    el.textContent = msg;
    el.className = isError ? "status error" : "status";
  }
}

async function withStatus<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  setStatus(`${label}...`);
  try {
    const result = await fn();
    setStatus(`${label}: done`);
    return result;
  } catch (err) {
    console.error(err);
    setStatus(`${label} failed: ${(err as Error).message}`, true);
    return null;
  }
}

// --- render loop -------------------------------------------------------------
async function tick() {
  const gameId = store.gameId;
  if (gameId === null) {
    renderLobbyPicker();
    return;
  }

  const [gamePubkey] = gamePda(gameId);
  const game = await fetchGame(gameId, baseConnection).catch(() => null);
  if (!game) {
    renderLobbyPicker("Game not found on base layer yet.");
    return;
  }

  const connection = game.state === GameState.InProgress ? erConnection : baseConnection;
  const players = await fetchPlayers(gamePubkey, connection).catch(() => [] as PlayerWithPda[]);
  const me = players.find((p) => p.authority.equals(wallet.publicKey)) ?? null;

  // Auto-delegate my own Player PDA once the game moves in-progress and I
  // haven't delegated yet (has_one=authority means only I can do this).
  if (game.state === GameState.InProgress && me) {
    const info = await baseConnection.getAccountInfo(me.pda).catch(() => null);
    if (info && info.owner.equals(PROGRAM_ID)) {
      await sendBase(wallet, delegatePlayerIx(wallet.publicKey, wallet.publicKey, gamePubkey)).catch((e) =>
        console.warn("auto delegate_player failed (will retry next tick):", e),
      );
    }
  }

  if (game.state === GameState.Ended) {
    renderWinScreen(game, players, me);
  } else if (game.state === GameState.Lobby) {
    renderLobby(gameId, gamePubkey, game, players, me);
  } else if (game.meetingActive) {
    renderMeeting(gamePubkey, game, players, me);
  } else if (me && !me.alive) {
    renderDeath(me);
  } else {
    renderGameView(gamePubkey, game, players, me);
  }
}

function startPolling() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => void tick(), 1500);
  void tick();
}

// --- lobby picker (no game joined yet) -------------------------------------
function renderLobbyPicker(message?: string) {
  app.innerHTML = `
    <div class="panel">
      <h1>RUGGED</h1>
      <p class="tagline">social deduction, on-chain, at ER speed</p>
      ${message ? `<p class="hint">${message}</p>` : ""}
      <div class="row">
        <button id="create">Create Lobby</button>
      </div>
      <div class="row">
        <input id="gameIdInput" placeholder="Game ID to join" />
        <button id="join">Load Game</button>
      </div>
      <p class="wallet">Wallet: ${wallet.publicKey.toBase58().slice(0, 8)}...</p>
      <p id="status" class="status"></p>
    </div>
  `;
  document.getElementById("create")!.addEventListener("click", async () => {
    const gameId = BigInt(Date.now());
    await withStatus("Creating lobby", async () => {
      await ensureFunded(wallet);
      await sendBase(wallet, initializeGameIx(wallet.publicKey, gameId));
      store.gameId = gameId;
    });
    startPolling();
  });
  document.getElementById("join")!.addEventListener("click", () => {
    const raw = (document.getElementById("gameIdInput") as HTMLInputElement).value.trim();
    if (!raw) return;
    store.gameId = BigInt(raw);
    startPolling();
  });
}

// --- lobby (joined, waiting for players) -----------------------------------
function renderLobby(gameId: bigint, gamePubkey: PublicKey, game: GameAccount, players: PlayerWithPda[], me: PlayerWithPda | null) {
  const isHost = game.authority.equals(wallet.publicKey);
  const canStart = isHost && game.playerCount >= 4 && game.rolesCommitted === game.playerCount;

  app.innerHTML = `
    <div class="panel">
      <h1>LOBBY #${gameId}</h1>
      <p class="hint">${game.playerCount}/6 players. Need 4-6, unique 3-5 char ticker.</p>
      <ul class="players">
        ${players
          .map((p) => `<li>${p.ticker} ${p.roleHash.some((b) => b) ? "(ready)" : "(picking ticker...)"}</li>`)
          .join("")}
      </ul>
      ${
        !me
          ? `<div class="row">
               <input id="ticker" placeholder="TICKER (3-5 chars)" maxlength="5" />
               <button id="joinGame">Join</button>
             </div>`
          : me.roleHash.every((b) => b === 0)
            ? `<div class="row"><button id="ready">Ready</button></div>`
            : `<p class="hint">Waiting for the rest of the crew...</p>`
      }
      ${isHost ? `<div class="row"><button id="start" ${canStart ? "" : "disabled"}>Start Game</button></div>` : ""}
      <p class="wallet">Wallet: ${wallet.publicKey.toBase58().slice(0, 8)}...</p>
      <p id="status" class="status"></p>
    </div>
  `;

  document.getElementById("joinGame")?.addEventListener("click", async () => {
    const ticker = (document.getElementById("ticker") as HTMLInputElement).value.trim().toUpperCase();
    if (ticker.length < 3 || ticker.length > 5) {
      setStatus("Ticker must be 3-5 characters", true);
      return;
    }
    if (players.some((p) => p.ticker === ticker)) {
      setStatus("Ticker already taken in this lobby", true);
      return;
    }
    await withStatus("Joining", async () => {
      await ensureFunded(wallet);
      await sendBase(wallet, joinIx(wallet.publicKey, gamePubkey, ticker));
    });
  });

  document.getElementById("ready")?.addEventListener("click", async () => {
    await withStatus("Committing role", async () => {
      const salt = store.salt;
      const preimage = new Uint8Array([Role.Crew, ...salt]);
      const commitment = await sha256(preimage);
      const [playerAccount] = playerPda(gamePubkey, wallet.publicKey);
      await sendBase(wallet, assignRolesIx(wallet.publicKey, gamePubkey, playerAccount, commitment));
    });
  });

  document.getElementById("start")?.addEventListener("click", async () => {
    await withStatus("Starting game", async () => {
      const allPdas = players.map((p) => p.pda);
      await sendBase(wallet, pickRuggerIx(wallet.publicKey, gamePubkey, allPdas));
      await sendBase(wallet, delegateGameIx(wallet.publicKey, wallet.publicKey, gameId));
    });
  });
}

// --- game view: map + move + rug + meeting ----------------------------------
const ROOM_LAYOUT: Record<Room, { x: number; y: number }> = {
  [Room.Turbine]: { x: 15, y: 15 },
  [Room.ProofOfHistory]: { x: 85, y: 15 },
  [Room.Gossip]: { x: 50, y: 55 },
  [Room.GulfStream]: { x: 50, y: 90 },
};

function renderGameView(gamePubkey: PublicKey, game: GameAccount, players: PlayerWithPda[], me: PlayerWithPda | null) {
  const rooms = [Room.Turbine, Room.ProofOfHistory, Room.Gossip, Room.GulfStream];
  const myRoomTargets = me ? rooms.filter((r) => isAdjacent(me.room, r)) : [];
  const targetsInRoom = me ? players.filter((p) => p.alive && !p.authority.equals(wallet.publicKey) && p.room === me.room) : [];

  app.innerHTML = `
    <div class="panel wide">
      <h1>RUGGED <span class="dim">#${game.gameId}</span></h1>
      <div class="map">
        ${rooms
          .map((r) => {
            const { x, y } = ROOM_LAYOUT[r];
            const occupants = players.filter((p) => p.alive && p.room === r);
            const clickable = me && me.alive && myRoomTargets.includes(r);
            return `
              <div class="room ${clickable ? "clickable" : ""}" data-room="${r}" style="left:${x}%;top:${y}%">
                <div class="room-label">${ROOM_NAMES[r]}</div>
                <div class="coins">
                  ${occupants.map((p) => `<span class="coin ${p.isRugger && p.authority.equals(wallet.publicKey) ? "me-rugger" : ""}">${p.ticker}</span>`).join("")}
                </div>
              </div>`;
          })
          .join("")}
      </div>
      <div class="hud">
        ${me ? `<p>You: <b>${me.ticker}</b> in ${ROOM_NAMES[me.room]} ${me.isRugger ? '<span class="rugger-tag">RUGGER</span>' : ""}</p>` : `<p>Spectating.</p>`}
        <div class="row">
          ${me?.alive ? `<button id="meeting">Call Meeting</button>` : ""}
          ${me?.alive && me.isRugger ? `<button id="rugBtn" ${targetsInRoom.length ? "" : "disabled"}>RUG</button>` : ""}
        </div>
        ${me?.alive && me.isRugger && targetsInRoom.length ? `
          <div class="row">
            ${targetsInRoom.map((p) => `<button class="target" data-target="${p.pda.toBase58()}">${p.ticker}</button>`).join("")}
          </div>` : ""}
        ${game.authority.equals(wallet.publicKey) ? `<div class="row"><button id="endGame">End Game (settle)</button></div>` : ""}
      </div>
      <p id="status" class="status"></p>
    </div>
  `;

  app.querySelectorAll<HTMLElement>(".room.clickable").forEach((el) => {
    el.addEventListener("click", async () => {
      const room = Number(el.dataset.room) as Room;
      if (!me) return;
      await withStatus("Moving", async () => {
        await sendEr(wallet, movePlayerIx(wallet.publicKey, gamePubkey, me.pda, room));
      });
    });
  });

  document.getElementById("meeting")?.addEventListener("click", async () => {
    if (!me) return;
    await withStatus("Calling meeting", async () => {
      await sendEr(wallet, callMeetingIx(wallet.publicKey, gamePubkey, me.pda));
    });
  });

  let selectedTarget: PublicKey | null = null;
  document.getElementById("rugBtn")?.addEventListener("click", async () => {
    if (!me || !selectedTarget) {
      setStatus(targetsInRoom.length ? "Pick a target first" : "No one else here", true);
      return;
    }
    await doRug(me, selectedTarget);
  });
  app.querySelectorAll<HTMLElement>(".target").forEach((el) => {
    el.addEventListener("click", () => {
      selectedTarget = new PublicKey(el.dataset.target!);
      app.querySelectorAll(".target").forEach((b) => b.classList.remove("selected"));
      el.classList.add("selected");
    });
  });

  async function doRug(rugger: PlayerWithPda, target: PublicKey) {
    await withStatus("Rugging", async () => {
      const others = players
        .filter((p) => !p.pda.equals(rugger.pda) && !p.pda.equals(target))
        .map((p) => p.pda);
      await sendEr(wallet, rugIx(wallet.publicKey, gamePubkey, rugger.pda, target, others));
    });
  }

  document.getElementById("endGame")?.addEventListener("click", async () => {
    await withStatus("Settling game", async () => {
      const delegated = players.map((p) => p.pda);
      await sendEr(wallet, endGameIx(wallet.publicKey, gamePubkey, wallet.publicKey, delegated));
    });
  });
}

// --- meeting / vote ----------------------------------------------------------
function renderMeeting(gamePubkey: PublicKey, game: GameAccount, players: PlayerWithPda[], me: PlayerWithPda | null) {
  const alive = players.filter((p) => p.alive);
  const isHost = game.authority.equals(wallet.publicKey);

  app.innerHTML = `
    <div class="panel">
      <h1>EMERGENCY MEETING</h1>
      <p class="hint">Who's the Rugger?</p>
      <ul class="players">
        ${alive
          .map(
            (p) => `<li>
              ${p.ticker}${p.authority.equals(wallet.publicKey) ? " (you)" : ""}
              ${me?.alive && !p.authority.equals(wallet.publicKey) ? `<button class="vote" data-target="${p.pda.toBase58()}">Vote</button>` : ""}
            </li>`,
          )
          .join("")}
      </ul>
      ${me?.alive ? `<div class="row"><button id="skip">Skip Vote</button></div>` : ""}
      ${isHost ? `<div class="row"><button id="resolve">Resolve Vote</button></div>` : ""}
      <p id="status" class="status"></p>
    </div>
  `;

  app.querySelectorAll<HTMLElement>(".vote").forEach((el) => {
    el.addEventListener("click", async () => {
      if (!me) return;
      await withStatus("Voting", async () => {
        await sendEr(wallet, voteIx(wallet.publicKey, gamePubkey, me.pda, new PublicKey(el.dataset.target!)));
      });
    });
  });
  document.getElementById("skip")?.addEventListener("click", async () => {
    if (!me) return;
    await withStatus("Skipping", async () => {
      await sendEr(wallet, voteIx(wallet.publicKey, gamePubkey, me.pda, null));
    });
  });
  document.getElementById("resolve")?.addEventListener("click", async () => {
    await withStatus("Resolving vote", async () => {
      const allPdas = players.map((p) => p.pda);
      await sendEr(wallet, resolveMeetingIx(wallet.publicKey, gamePubkey, allPdas));
    });
  });
}

// --- death: flatlining price chart -------------------------------------------
function renderDeath(me: PlayerWithPda) {
  app.innerHTML = `
    <div class="panel">
      <h1>RUGGED</h1>
      <p class="ticker-dead">${me.ticker}</p>
      <svg class="chart" viewBox="0 0 200 60" preserveAspectRatio="none">
        <polyline points="0,10 20,25 35,15 50,30 65,20 80,35 100,30 200,30" fill="none" stroke="#ff3b3b" stroke-width="2"/>
      </svg>
      <p class="hint">You have been eliminated. Spectating...</p>
      <p id="status" class="status"></p>
    </div>
  `;
}

// --- win screen ----------------------------------------------------------
function renderWinScreen(game: GameAccount, players: PlayerWithPda[], me: PlayerWithPda | null) {
  const line =
    game.winner === Winner.Rugger ? "It was a rug all along." : "The Rugger was slashed.";
  const rugger = players.find((p) => p.isRugger);

  app.innerHTML = `
    <div class="panel">
      <h1>GAME OVER</h1>
      <p class="win-line">${line}</p>
      ${rugger ? `<p class="hint">The Rugger was <b>${rugger.ticker}</b>.</p>` : ""}
      ${me ? `<p class="hint">You: ${me.ticker} ${me.alive ? "(survived)" : "(eliminated)"}</p>` : ""}
      <div class="row"><button id="newGame">New Lobby</button></div>
      <p id="status" class="status"></p>
    </div>
  `;
  document.getElementById("newGame")?.addEventListener("click", () => {
    store.gameId = null;
    startPolling();
  });
}

startPolling();
