import { describe, expect, it } from 'vitest';
import { scoreHand } from '@rook/engine';
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

const createRoomState = () => ({
  roomCode: 'ROOMX',
  seats: createSeats(),
  players: Object.values(createSeats()),
  ready: {
    'player-a': true,
    'player-b': true,
    'player-c': true,
    'player-d': true,
  },
  playerNames: {
    'player-a': 'A',
    'player-b': 'B',
    'player-c': 'C',
    'player-d': 'D',
  },
  ownerId: 'player-a',
  targetScore: 700,
});

describe('Game reducer', () => {
  it('starts game in preDeal and only dealer can deal', () => {
    const store = new GameStore();
    const started = store.startGame(createRoomState());
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.phase).toBe('preDeal');
    expect(started.value.whoseTurnPlayerId).toBe('player-a');

    const nonDealerDeal = store.dealHand('ROOMX', 'player-b', 'rookLow');
    expect(nonDealerDeal.ok).toBe(false);
    if (!nonDealerDeal.ok) {
      expect(nonDealerDeal.error).toBe('only dealer may deal');
    }

    const dealerDeal = store.dealHand('ROOMX', 'player-a', 'rookLow');
    expect(dealerDeal.ok).toBe(true);
    if (!dealerDeal.ok) return;
    expect(dealerDeal.value.phase).toBe('bidding');
    expect(dealerDeal.value.rookRankMode).toBe('rookLow');
    expect(dealerDeal.value.hand.hands[0].length).toBeGreaterThan(0);
    expect(dealerDeal.value.hand.kitty.length).toBe(5);
  });

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

  it('awards dealer an automatic 100 bid when everyone passes', () => {
    const createResult = createGameState('ROOM12', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    // Dealer is player 0 by default; bidding starts with player 1.
    const afterPass1 = reduceGameState(state, state.playerOrder[1], { type: 'pass' });
    const afterPass2 = reduceGameState(afterPass1, state.playerOrder[2], { type: 'pass' });
    const afterPass3 = reduceGameState(afterPass2, state.playerOrder[3], { type: 'pass' });

    expect(afterPass3.phase).toBe('kitty');
    expect(afterPass3.hand.winningBid).toEqual({ player: 0, amount: 100 });
    expect(afterPass3.hand.bidder).toBe(0);
    expect(afterPass3.bidding.highBid).toEqual({ player: 0, amount: 100 });
    expect(afterPass3.whoseTurnSeat).toBe(afterPass3.seatOrder[0]);
    expect(afterPass3.hand.kittyPickedUp).toBe(true);
    expect(afterPass3.hand.kittyPickedUpCards.length).toBe(5);
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
    expect(play4.value.hand.trickCards).toHaveLength(4);
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

  it('treats rook lead as trump lead for follow-suit', () => {
    const createResult = createGameState('ROOM9', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    const store = new GameStore();

    (store as { games: Map<string, { state: typeof state }> }).games.set('ROOM9', {
      state: {
        ...state,
        phase: 'trick',
        whoseTurnSeat: state.seatOrder[0],
        whoseTurnPlayerId: state.playerOrder[0],
        hand: {
          ...state.hand,
          phase: 'trick',
          trump: 'green',
          trickCards: [],
          trickLeadColor: undefined,
          hands: [
            [{ kind: 'rook' }],
            [suitCard('green', 10), suitCard('red', 9)],
            [suitCard('yellow', 3)],
            [suitCard('black', 2)],
          ],
        },
      },
    });

    const leadPlay = store.playCard('ROOM9', state.playerOrder[0], { kind: 'rook' });
    expect(leadPlay.ok).toBe(true);

    const illegalPlay = store.playCard('ROOM9', state.playerOrder[1], suitCard('red', 9));
    expect(illegalPlay.ok).toBe(false);
    if (!illegalPlay.ok) {
      expect(illegalPlay.error).toBe('illegal play');
    }

    const legalPlay = store.playCard('ROOM9', state.playerOrder[1], suitCard('green', 10));
    expect(legalPlay.ok).toBe(true);
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

  it('does not allow undo after a trick completes (4th card)', () => {
    const createResult = createGameState('ROOM10', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    const store = new GameStore();
    const trickCards = [
      suitCard('red', 5),
      suitCard('yellow', 9),
      suitCard('black', 10),
      suitCard('green', 1),
    ];

    (store as { games: Map<string, { state: typeof state }> }).games.set('ROOM10', {
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
        },
      },
    });

    store.playCard('ROOM10', state.playerOrder[0], trickCards[0]);
    store.playCard('ROOM10', state.playerOrder[1], trickCards[1]);
    store.playCard('ROOM10', state.playerOrder[2], trickCards[2]);
    const finalPlay = store.playCard('ROOM10', state.playerOrder[3], trickCards[3]);
    expect(finalPlay.ok).toBe(true);

    const undo = store.undoPlay('ROOM10', state.playerOrder[3]);
    expect(undo.ok).toBe(false);
    if (!undo.ok) {
      // After trick completion, undo is no longer offered.
      expect(undo.error).toBe('no undo available');
    }
  });

  it('keeps completed trick visible until winner leads next trick', () => {
    const createResult = createGameState('ROOM11', createSeats());
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const state = createResult.value;
    const store = new GameStore();
    const cardA = suitCard('red', 5);
    const cardB = suitCard('yellow', 9);
    const cardC = suitCard('black', 10);
    const cardD = suitCard('green', 1);
    const nextLead = suitCard('red', 8);

    (store as { games: Map<string, { state: typeof state }> }).games.set('ROOM11', {
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
          hands: [
            [cardA, nextLead],
            [cardB],
            [cardC],
            [cardD],
          ],
        },
      },
    });

    store.playCard('ROOM11', state.playerOrder[0], cardA);
    store.playCard('ROOM11', state.playerOrder[1], cardB);
    store.playCard('ROOM11', state.playerOrder[2], cardC);
    const trickComplete = store.playCard('ROOM11', state.playerOrder[3], cardD);
    expect(trickComplete.ok).toBe(true);
    if (!trickComplete.ok) return;

    expect(trickComplete.value.hand.trickCards).toHaveLength(4);

    // Winner is player 0 via trump; their next play should clear old trick and start a new one.
    const next = store.playCard('ROOM11', state.playerOrder[0], nextLead);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value.hand.trickCards).toHaveLength(1);
    expect(next.value.hand.trickCards[0]?.seat).toBe(state.seatOrder[0]);
  });
});
