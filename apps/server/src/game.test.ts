import { describe, expect, it } from 'vitest';
import { createGameState, reduceGameState } from './game.js';
import { type Seat } from './rooms.js';

const createSeats = (): Record<Seat, string> => ({
  T1P1: 'player-a',
  T2P1: 'player-b',
  T1P2: 'player-c',
  T2P2: 'player-d',
});

describe('Game reducer', () => {
  it('advances turn after bid and pass', () => {
    const createResult = createGameState('ROOM1', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    expect(state.whoseTurnPlayerId).toBe('player-a');

    const afterBid = reduceGameState(state, 'player-a', { type: 'bid', amount: 100 });
    expect(afterBid.bidding.highBid?.amount).toBe(100);
    expect(afterBid.whoseTurnPlayerId).toBe('player-b');

    const afterPass = reduceGameState(afterBid, 'player-b', { type: 'pass' });
    expect(afterPass.bidding.passed[1]).toBe(true);
    expect(afterPass.whoseTurnPlayerId).toBe('player-c');
  });

  it('throws when a non-current player acts', () => {
    const createResult = createGameState('ROOM2', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    expect(() => reduceGameState(state, 'player-c', { type: 'bid', amount: 100 })).toThrow(
      'current player',
    );
  });
});
