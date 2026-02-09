import { describe, expect, it } from 'vitest';
import type { Card } from '../src/cards.js';
import { determineTrickWinner, getLegalPlays } from '../src/trick.js';

describe('trick', () => {
  it('enforces follow-suit when possible', () => {
    const hand: Card[] = [
      { kind: 'suit', color: 'red', rank: 10 },
      { kind: 'suit', color: 'yellow', rank: 2 },
      { kind: 'rook' },
    ];

    expect(getLegalPlays(hand, 'red', 'black', 'rookHigh')).toEqual(['RED_10']);
    expect(getLegalPlays(hand, 'green', 'black', 'rookHigh')).toEqual([
      'RED_10',
      'YELLOW_2',
      'ROOK',
    ]);
  });

  it('picks winner with trump and rook ranking', () => {
    const trickCards: Card[] = [
      { kind: 'suit', color: 'red', rank: 10 },
      { kind: 'suit', color: 'black', rank: 9 },
      { kind: 'suit', color: 'red', rank: 1 },
    ];

    expect(determineTrickWinner(trickCards, 'red', 'black', 'rookHigh')).toBe(1);
  });

  it('handles rook high vs low', () => {
    const trickCards: Card[] = [
      { kind: 'suit', color: 'black', rank: 14 },
      { kind: 'rook' },
      { kind: 'suit', color: 'black', rank: 1 },
    ];

    expect(determineTrickWinner(trickCards, 'black', 'black', 'rookHigh')).toBe(1);
    expect(determineTrickWinner(trickCards, 'black', 'black', 'rookLow')).toBe(2);
  });
});
