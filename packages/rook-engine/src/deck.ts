import type { Card, Color } from './cards.js';
import type { DeckMode } from './index.js';

const COLORS: Color[] = ['red', 'yellow', 'green', 'black'];

export function buildDeck(deckMode: DeckMode): Card[] {
  const ranks: number[] = [];
  for (let r = 1; r <= 14; r++) {
    if (deckMode === 'fast' && (r === 2 || r === 3 || r === 4)) continue;
    ranks.push(r);
  }

  const suited: Card[] = [];
  for (const c of COLORS) {
    for (const r of ranks) suited.push({ kind: 'suit', color: c, rank: r });
  }

  // + rook
  return [...suited, { kind: 'rook' }];
}

export function mulberry32(seed: number): () => number {
  // Deterministic PRNG for reproducible tests.
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function deal(deck: Card[], kittySize: number): { hands: Card[][]; kitty: Card[] } {
  if (kittySize <= 0) throw new Error('kittySize must be > 0');
  const remaining = deck.length - kittySize;
  if (remaining <= 0) throw new Error('deck too small for kitty');
  if (remaining % 4 !== 0) {
    throw new Error(`deck minus kitty must be divisible by 4; got deck=${deck.length} kitty=${kittySize}`);
  }

  const perHand = remaining / 4;
  const hands: Card[][] = [[], [], [], []];

  let idx = 0;
  for (let r = 0; r < perHand; r++) {
    for (let p = 0; p < 4; p++) {
      hands[p].push(deck[idx++]);
    }
  }

  const kitty = deck.slice(idx, idx + kittySize);
  return { hands, kitty };
}
