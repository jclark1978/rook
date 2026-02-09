import { describe, expect, it } from 'vitest';
import { createGameState, GameStore, reduceGameState } from './game.js';
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

  it('removes a card from the hand when played', () => {
    const createResult = createGameState('ROOM3', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    const playerId = state.playerOrder[0];
    const card = state.hand.hands[0]?.[0];
    expect(card).toBeTruthy();
    if (!card) return;

    const store = new GameStore();
    (store as { games: Map<string, { state: typeof state }> }).games.set('ROOM3', {
      state: {
        ...state,
        phase: 'trick',
        whoseTurnSeat: state.seatOrder[0],
        whoseTurnPlayerId: playerId,
        hand: {
          ...state.hand,
          phase: 'trick',
          trump: 'red',
          trickCards: [],
        },
      },
    });

    const beforeCount = state.hand.hands[0].length;
    const playResult = store.playCard('ROOM3', playerId, card);
    expect(playResult.ok).toBe(true);
    if (!playResult.ok) return;

    expect(playResult.value.hand.hands[0].length).toBe(beforeCount - 1);
  });
});
