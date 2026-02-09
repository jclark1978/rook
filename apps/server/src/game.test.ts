import { describe, expect, it } from 'vitest';
import { scoreHand } from '@rook/engine/src/scoring.js';
import { createGameState, GameStore, reduceGameState } from './game.js';
import { type Seat } from './rooms.js';

const createSeats = (): Record<Seat, string> => ({
  T1P1: 'player-a',
  T2P1: 'player-b',
  T1P2: 'player-c',
  T2P2: 'player-d',
});

const suitCard = (color: 'red' | 'yellow' | 'green' | 'black', rank: number) => ({
  kind: 'suit' as const,
  color,
  rank,
});

describe('Game reducer', () => {
  it('advances turn after bid and pass', () => {
    const createResult = createGameState('ROOM1', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    // Bidding starts to the dealer's left. Default dealer is seat index 0, so first bidder is index 1.
    expect(state.whoseTurnPlayerId).toBe('player-b');

    const afterBid = reduceGameState(state, 'player-b', { type: 'bid', amount: 100 });
    expect(afterBid.bidding.highBid?.amount).toBe(100);
    expect(afterBid.whoseTurnPlayerId).toBe('player-c');

    const afterPass = reduceGameState(afterBid, 'player-c', { type: 'pass' });
    expect(afterPass.bidding.passed[2]).toBe(true);
    expect(afterPass.whoseTurnPlayerId).toBe('player-d');
  });

  it('starts bidding from the seat left of the dealer', () => {
    const createResult = createGameState('ROOM7', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    const dealerIndex = state.seatOrder.indexOf(state.dealerSeat);
    const leftOfDealer = state.seatOrder[(dealerIndex + 1) % state.seatOrder.length];

    expect(state.hand.dealerSeat).toBe(state.dealerSeat);
    expect(state.whoseTurnSeat).toBe(leftOfDealer);
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

  it('removes the played card from the correct player hand', () => {
    const createResult = createGameState('ROOM6', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    const store = new GameStore();
    const playerIndex = 1;
    const playedCard = suitCard('red', 9);
    const remainingCard = suitCard('yellow', 2);

    (store as { games: Map<string, { state: typeof state }> }).games.set('ROOM6', {
      state: {
        ...state,
        phase: 'trick',
        whoseTurnSeat: state.seatOrder[playerIndex],
        whoseTurnPlayerId: state.playerOrder[playerIndex],
        hand: {
          ...state.hand,
          phase: 'trick',
          trump: 'red',
          trickCards: [],
          trickLeadColor: undefined,
          hands: [
            [suitCard('green', 3)],
            [playedCard, remainingCard],
            [suitCard('black', 4)],
            [suitCard('yellow', 5)],
          ],
        },
      },
    });

    const playResult = store.playCard('ROOM6', state.playerOrder[playerIndex], playedCard);
    expect(playResult.ok).toBe(true);
    if (!playResult.ok) return;

    expect(playResult.value.hand.hands[playerIndex]).toEqual([remainingCard]);
    expect(playResult.value.hand.hands[0]).toEqual([suitCard('green', 3)]);
  });

  it('awards the trick to a trump winner', () => {
    const createResult = createGameState('ROOM4', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    const store = new GameStore();
    (store as { games: Map<string, { state: typeof state }> }).games.set('ROOM4', {
      state: {
        ...state,
        phase: 'trick',
        whoseTurnSeat: state.seatOrder[0],
        whoseTurnPlayerId: state.playerOrder[0],
        hand: {
          ...state.hand,
          phase: 'trick',
          trump: 'black',
          trickCards: [],
          trickLeadColor: undefined,
          hands: [
            [suitCard('red', 10)],
            [suitCard('yellow', 14)],
            [suitCard('black', 2)],
            [suitCard('red', 14)],
          ],
        },
      },
    });

    const play1 = store.playCard('ROOM4', state.playerOrder[0], suitCard('red', 10));
    expect(play1.ok).toBe(true);
    const play2 = store.playCard('ROOM4', state.playerOrder[1], suitCard('yellow', 14));
    expect(play2.ok).toBe(true);
    const play3 = store.playCard('ROOM4', state.playerOrder[2], suitCard('black', 2));
    expect(play3.ok).toBe(true);
    const play4 = store.playCard('ROOM4', state.playerOrder[3], suitCard('red', 14));
    expect(play4.ok).toBe(true);
    if (!play4.ok) return;

    expect(play4.value.whoseTurnSeat).toBe(state.seatOrder[2]);
    expect(play4.value.hand.trickCards).toHaveLength(0);
  });

  it('tracks captured cards and last trick winner team', () => {
    const createResult = createGameState('ROOM8', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    const store = new GameStore();
    const card1 = suitCard('red', 10);
    const card2 = suitCard('yellow', 14);
    const card3 = suitCard('black', 2);
    const card4 = suitCard('red', 14);

    (store as { games: Map<string, { state: typeof state }> }).games.set('ROOM8', {
      state: {
        ...state,
        phase: 'trick',
        whoseTurnSeat: state.seatOrder[0],
        whoseTurnPlayerId: state.playerOrder[0],
        hand: {
          ...state.hand,
          phase: 'trick',
          trump: 'black',
          trickCards: [],
          trickLeadColor: undefined,
          hands: [[card1], [card2], [card3], [card4]],
        },
      },
    });

    const play1 = store.playCard('ROOM8', state.playerOrder[0], card1);
    expect(play1.ok).toBe(true);
    const play2 = store.playCard('ROOM8', state.playerOrder[1], card2);
    expect(play2.ok).toBe(true);
    const play3 = store.playCard('ROOM8', state.playerOrder[2], card3);
    expect(play3.ok).toBe(true);
    const play4 = store.playCard('ROOM8', state.playerOrder[3], card4);
    expect(play4.ok).toBe(true);
    if (!play4.ok) return;

    expect(play4.value.hand.capturedByTeam.T1).toEqual([card1, card2, card3, card4]);
    expect(play4.value.hand.capturedByTeam.T2).toEqual([]);
    expect(play4.value.hand.lastTrickWinnerTeam).toBe('T1');
  });

  it('enforces follow-suit when a lead color is set', () => {
    const createResult = createGameState('ROOM5', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    const store = new GameStore();
    (store as { games: Map<string, { state: typeof state }> }).games.set('ROOM5', {
      state: {
        ...state,
        phase: 'trick',
        whoseTurnSeat: state.seatOrder[0],
        whoseTurnPlayerId: state.playerOrder[0],
        hand: {
          ...state.hand,
          phase: 'trick',
          trump: 'black',
          trickCards: [],
          trickLeadColor: undefined,
          hands: [
            [suitCard('red', 5)],
            [suitCard('red', 7), suitCard('yellow', 9)],
            [suitCard('green', 3)],
            [suitCard('black', 2)],
          ],
        },
      },
    });

    const leadPlay = store.playCard('ROOM5', state.playerOrder[0], suitCard('red', 5));
    expect(leadPlay.ok).toBe(true);

    const illegalPlay = store.playCard('ROOM5', state.playerOrder[1], suitCard('yellow', 9));
    expect(illegalPlay.ok).toBe(false);
    if (!illegalPlay.ok) {
      expect(illegalPlay.error).toBe('illegal play');
    }
  });

  it('scores a set hand when the bidding team misses', () => {
    const createResult = createGameState('ROOM7', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    const store = new GameStore();
    const kittyCards = [suitCard('red', 10), suitCard('black', 5)];
    const trickCards = [
      suitCard('yellow', 9),
      suitCard('yellow', 5),
      suitCard('yellow', 10),
      suitCard('yellow', 14),
    ];

    (store as { games: Map<string, { state: typeof state }> }).games.set('ROOM7', {
      state: {
        ...state,
        phase: 'trick',
        whoseTurnSeat: state.seatOrder[0],
        whoseTurnPlayerId: state.playerOrder[0],
        hand: {
          ...state.hand,
          phase: 'trick',
          trump: 'black',
          trickCards: [],
          trickLeadColor: undefined,
          hands: [[trickCards[0]], [trickCards[1]], [trickCards[2]], [trickCards[3]]],
          kitty: kittyCards,
          bidder: 0,
          winningBid: { player: 0, amount: 120 },
          capturedByTeam: { T1: [], T2: [] },
          lastTrickWinnerTeam: null,
        },
        gameScore: [0, 0],
      },
    });

    store.playCard('ROOM7', state.playerOrder[0], trickCards[0]);
    store.playCard('ROOM7', state.playerOrder[1], trickCards[1]);
    store.playCard('ROOM7', state.playerOrder[2], trickCards[2]);
    const finalPlay = store.playCard('ROOM7', state.playerOrder[3], trickCards[3]);
    expect(finalPlay.ok).toBe(true);
    if (!finalPlay.ok) return;

    const expected = scoreHand([[], trickCards], 1, kittyCards, 0, 120);
    expect(finalPlay.value.phase).toBe('score');
    expect(finalPlay.value.gameScore).toEqual(expected.scores);
  });

  it('scores a made hand with the bidding team points', () => {
    const createResult = createGameState('ROOM8', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    const store = new GameStore();
    const kittyCards = [suitCard('red', 10)];
    const trickCards = [
      suitCard('red', 5),
      suitCard('yellow', 9),
      suitCard('black', 10),
      suitCard('green', 1),
    ];

    (store as { games: Map<string, { state: typeof state }> }).games.set('ROOM8', {
      state: {
        ...state,
        phase: 'trick',
        whoseTurnSeat: state.seatOrder[0],
        whoseTurnPlayerId: state.playerOrder[0],
        hand: {
          ...state.hand,
          phase: 'trick',
          trump: 'red',
          trickCards: [],
          trickLeadColor: undefined,
          hands: [[trickCards[0]], [trickCards[1]], [trickCards[2]], [trickCards[3]]],
          kitty: kittyCards,
          bidder: 0,
          winningBid: { player: 0, amount: 40 },
          capturedByTeam: { T1: [], T2: [] },
          lastTrickWinnerTeam: null,
        },
        gameScore: [0, 0],
      },
    });

    store.playCard('ROOM8', state.playerOrder[0], trickCards[0]);
    store.playCard('ROOM8', state.playerOrder[1], trickCards[1]);
    store.playCard('ROOM8', state.playerOrder[2], trickCards[2]);
    const finalPlay = store.playCard('ROOM8', state.playerOrder[3], trickCards[3]);
    expect(finalPlay.ok).toBe(true);
    if (!finalPlay.ok) return;

    const expected = scoreHand([trickCards, []], 0, kittyCards, 0, 40);
    expect(finalPlay.value.phase).toBe('score');
    expect(finalPlay.value.gameScore).toEqual(expected.scores);
  });
});
