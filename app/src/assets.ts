// Image preloader for room backgrounds, title, and coin states.
// Warms the browser cache so scene transitions don't pop in.

export type RoomName =
  | 'turbine'
  | 'poh'
  | 'gossip'
  | 'gulfstream'
  | 'conference'
  | 'validator'
  | 'server'
  | 'vault'
  | 'trading'
  | 'airdrop'
  | 'firewall'
  | 'compliance'
  | 'recovery'
  | 'governance';
export type CoinState = 'base' | 'rugged' | 'rugger-hint';

const ROOM_IMAGES: Record<RoomName, string> = {
  turbine: '/img/room-turbine.png',
  poh: '/img/room-poh.png',
  gossip: '/img/room-gossip.png',
  gulfstream: '/img/room-gulfstream.png',
  conference: '/img/room-conference.png',
  validator: '/img/room-validator.png',
  server: '/img/room-server.png',
  vault: '/img/room-vault.png',
  trading: '/img/room-trading.png',
  airdrop: '/img/room-airdrop.png',
  firewall: '/img/room-firewall.png',
  compliance: '/img/room-compliance.png',
  recovery: '/img/room-recovery.png',
  governance: '/img/room-governance.png',
};

const COIN_IMAGES: Record<CoinState, string> = {
  base: '/img/coin-base.png',
  rugged: '/img/coin-rugged.png',
  'rugger-hint': '/img/coin-rugger-hint.png',
};

const TITLE_IMAGE = '/img/title.png';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${src}`));
    img.src = src;
  });
}

/** Preload all room backgrounds, the title art, and coin state sprites. Resolves once every image has loaded (or failed, logged, and skipped). */
export async function preloadAssets(): Promise<void> {
  const sources = [TITLE_IMAGE, ...Object.values(ROOM_IMAGES), ...Object.values(COIN_IMAGES)];
  await Promise.all(
    sources.map((src) =>
      loadImage(src).catch((err) => {
        console.warn(err.message);
      }),
    ),
  );
}

export function roomImage(room: RoomName): string {
  return ROOM_IMAGES[room];
}

export function coinImage(state: CoinState): string {
  return COIN_IMAGES[state];
}

export function titleImage(): string {
  return TITLE_IMAGE;
}
