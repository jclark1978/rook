import { describe, expect, it } from 'vitest';
import {
  applyHandAction,
  createHandStateFromDeal,
  type Card,
  type HandState,
} from '../src/hand.js';

function suit(color: Card['color'], rank: number): Card {
  return { kind: 'suit', color, rank };
}

const rook: Card = { kind: 'rook' };

describe('hand flow', () => {
  function makeState(): HandState {
    const hands: [Card[], Card[], Card[], Card[]] = [
      [suit('red', 1), suit('red', 5), suit('green', 9)],
      [suit('yellow', 2)],
      [suit('black', 3)],
      [suit('green', 4)],
    ];
    const kitty = [suit('red', 10), suit('yellow', 5), suit('green', 10), suit('black', 14), rook];
    return createHandStateFromDeal({ deckMode: 'full', rookRankMode: 'rookHigh' }, hands, kitty);
  }

  it('advances from bidding to declareTrump after discard', () => {
    let state = makeState();

    state = applyHandAction(state, { type: 'bid', player: 0, amount: 100 });
    state = applyHandAction(state, { type: 'pass', player: 1 });
    state = applyHandAction(state, { type: 'pass', player: 2 });
    state = applyHandAction(state, { type: 'pass', player: 3 });

    expect(state.phase).toBe('kittyPickup');
    expect(state.bidder).toBe(0);
    expect(state.winningBid).toBe(100);

    state = applyHandAction(state, { type: 'pickupKitty', player: 0 });
    expect(state.phase).toBe('kittyDiscard');
    expect(state.kitty).toHaveLength(0);
    expect(state.hands[0]).toHaveLength(8);

    const discard = [
      suit('red', 1),
      suit('red', 10),
      suit('yellow', 5),
      suit('green', 10),
      rook,
    ];
    state = applyHandAction(state, { type: 'discardToKitty', player: 0, cards: discard });
    expect(state.phase).toBe('declareTrump');
    expect(state.kitty).toEqual(discard);
    expect(state.hands[0]).toHaveLength(3);

    state = applyHandAction(state, { type: 'declareTrump', player: 0, color: 'red' });
    expect(state.phase).toBe('trick');
    expect(state.trumpColor).toBe('red');
  });

  it('requires exactly five cards to discard', () => {
    let state = makeState();

    state = applyHandAction(state, { type: 'bid', player: 0, amount: 100 });
    state = applyHandAction(state, { type: 'pass', player: 1 });
    state = applyHandAction(state, { type: 'pass', player: 2 });
    state = applyHandAction(state, { type: 'pass', player: 3 });
    state = applyHandAction(state, { type: 'pickupKitty', player: 0 });

    expect(() =>
      applyHandAction(state, {
        type: 'discardToKitty',
        player: 0,
        cards: [suit('red', 1)],
      }),
    ).toThrow('Must discard exactly 5 cards to the kitty.');
  });
});
