import { describe, expect, it } from 'vitest';
import type { Card } from '../src/cards.js';
import type { TrickRound } from '../src/trickRound.js';
import { trickWinner } from '../src/trickRound.js';

describe('trickRound', () => {
  it('picks winner with trump', () => {
    const cards: Card[] = [
      { kind: 'suit', color: 'red', rank: 10 },
      { kind: 'suit', color: 'black', rank: 9 },
      { kind: 'suit', color: 'red', rank: 1 },
    ];

    const trick: TrickRound = {
      leadColor: 'red',
      cards,
      seats: ['T1P1', 'T2P1', 'T1P2'],
      trumpColor: 'black',
      rookRankMode: 'rookHigh',
    };

    expect(trickWinner(trick)).toBe('T2P1');
  });

  it('handles rook high vs low', () => {
    const cards: Card[] = [
      { kind: 'suit', color: 'black', rank: 14 },
      { kind: 'rook' },
      { kind: 'suit', color: 'black', rank: 1 },
    ];

    const base: Omit<TrickRound, 'rookRankMode'> = {
      leadColor: 'black',
      cards,
      seats: ['T1P1', 'T2P1', 'T1P2'],
      trumpColor: 'black',
    };

    expect(trickWinner({ ...base, rookRankMode: 'rookHigh' })).toBe('T2P1');
    expect(trickWinner({ ...base, rookRankMode: 'rookLow' })).toBe('T1P2');
  });
});
