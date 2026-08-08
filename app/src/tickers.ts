// Curated ticker manifest for token-skinned coin sprites.
// Source: rugged-assets/tokens/mints/*.json (mint addresses of real Solana meme tokens,
// used here only as flavor text/sprites, not for on-chain lookups).

export interface TickerEntry {
  ticker: string;
  mint: string;
  sprite: string;
  /** Dominant sprite color, used for the client-side CSS tint (drop-shadow) instead of the old hue-rotate filter. */
  color: string;
}

export const FALLBACK_SPRITE = '/img/coin-base.png';

export const TICKERS: TickerEntry[] = [
  { ticker: 'BOME', mint: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', sprite: '/tokens/coin-BOME.png', color: '#c34dad' },
  { ticker: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', sprite: '/tokens/coin-BONK.png', color: '#eaab13' },
  { ticker: 'FWOG', mint: 'A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump', sprite: '/tokens/coin-FWOG.png', color: '#5bcd99' },
  { ticker: 'GIGA', mint: '63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9', sprite: '/tokens/coin-GIGA.png', color: '#7b6d41' },
  { ticker: 'MEW', mint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', sprite: '/tokens/coin-MEW.png', color: '#ed3c47' },
  { ticker: 'MOODENG', mint: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', sprite: '/tokens/coin-MOODENG.png', color: '#a78756' },
  { ticker: 'MYRO', mint: 'HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4', sprite: '/tokens/coin-MYRO.png', color: '#73597f' },
  { ticker: 'PNUT', mint: '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', sprite: '/tokens/coin-PNUT.png', color: '#cd966e' },
  { ticker: 'PONKE', mint: '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC', sprite: '/tokens/coin-PONKE.png', color: '#d99916' },
  { ticker: 'POPCAT', mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', sprite: '/tokens/coin-POPCAT.png', color: '#e6a79f' },
  { ticker: 'SILLY', mint: '7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs', sprite: '/tokens/coin-SILLY.png', color: '#88aba3' },
  { ticker: 'SLERF', mint: '9999FVbjHioTcoJpoBiSjpxHW6xEn3witVuXKqBh2RFQ', sprite: '/tokens/coin-SLERF.png', color: '#ebb532' },
  { ticker: 'WEN', mint: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk', sprite: '/tokens/coin-WEN.png', color: '#5493c2' },
  { ticker: 'WIF', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', sprite: '/tokens/coin-WIF.png', color: '#b1845b' },
];

export function spriteForTicker(ticker: string): string {
  return TICKERS.find((t) => t.ticker === ticker)?.sprite ?? FALLBACK_SPRITE;
}

export function randomTicker(): TickerEntry {
  return TICKERS[Math.floor(Math.random() * TICKERS.length)];
}
