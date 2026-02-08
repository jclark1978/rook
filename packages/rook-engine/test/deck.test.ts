import { describe, expect, it } from 'vitest';
import { buildDeck, deal, mulberry32, shuffle } from '../src/deck.js';

describe('deck building + deal', () => {
  it('full deck is 57; deal 13 each + kitty 5', () => {
    const deck = buildDeck('full');
    expect(deck).toHaveLength(57);
    const { hands, kitty } = deal(deck, 5);
    expect(kitty).toHaveLength(5);
    expect(hands).toHaveLength(4);
    for (const h of hands) expect(h).toHaveLength(13);
  });

  it('fast deck is 45; deal 10 each + kitty 5', () => {
    const deck = buildDeck('fast');
    expect(deck).toHaveLength(45);
    const { hands, kitty } = deal(deck, 5);
    expect(kitty).toHaveLength(5);
    for (const h of hands) expect(h).toHaveLength(10);
  });

  it('shuffle is deterministic with seed', () => {
    const deck = buildDeck('fast');
    const s1 = shuffle(deck, mulberry32(123)).map((c) => JSON.stringify(c)).slice(0, 10);
    const s2 = shuffle(deck, mulberry32(123)).map((c) => JSON.stringify(c)).slice(0, 10);
    expect(s1).toEqual(s2);
  });
});
