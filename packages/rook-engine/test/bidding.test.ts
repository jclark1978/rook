import { describe, expect, it } from 'vitest';
import {
  applyBiddingAction,
  createBiddingState,
  getWinningBid,
  isBiddingComplete,
} from '../src/bidding.js';

describe('bidding', () => {
  it('Jeff example sequence resolves winner', () => {
    let state = createBiddingState(0, 100, 5);

    state = applyBiddingAction(state, { type: 'bid', player: 0, amount: 120 });
    state = applyBiddingAction(state, { type: 'pass', player: 1 });
    state = applyBiddingAction(state, { type: 'passPartner', player: 2 });
    state = applyBiddingAction(state, { type: 'bid', player: 3, amount: 140 });
    state = applyBiddingAction(state, { type: 'pass', player: 0 });
    state = applyBiddingAction(state, { type: 'bid', player: 2, amount: 150 });
    state = applyBiddingAction(state, { type: 'pass', player: 3 });

    expect(isBiddingComplete(state)).toBe(true);
    expect(getWinningBid(state)).toEqual({ player: 2, amount: 150 });
  });
});
