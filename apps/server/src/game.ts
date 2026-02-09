import {
  applyBiddingAction,
  createBiddingState,
  type BiddingState,
  type Bid,
  getWinningBid,
  isBiddingComplete,
  type PlayerId,
  teamOf,
} from '@rook/engine/src/bidding.js';
import type { Card } from '@rook/engine/src/cards.js';
import { cardId, isPointCard } from '@rook/engine/src/cards.js';
import type { DeckMode } from '@rook/engine/src/index.js';
import { buildDeck, deal, mulberry32, shuffle } from '@rook/engine/src/deck.js';
import { scoreHand } from '@rook/engine/src/scoring.js';
import { determineTrickWinner, getLegalPlays, type TrumpColor } from '@rook/engine/src/trick.js';
import { SEATS, type RoomState, type Seat } from './rooms.js';

export type GamePhase = 'bidding' | 'kitty' | 'declareTrump' | 'trick' | 'score';

export type HandState = {
  phase: GamePhase;
  deckMode: DeckMode;
  startedAt: number;
  seed: number;
  kittySize: number;
  kitty: Card[];
  kittyPickedUpCards: Card[];
  pointsNoticeSent: boolean;
  hands: Card[][];
  trickCards: Array<{ seat: Seat; card: Card }>;
  trickLeadColor?: TrumpColor;
  bidder: PlayerId | null;
  winningBid: Bid | null;
  trump?: TrumpColor;
  kittyPickedUp: boolean;
  capturedByTeam: [Card[], Card[]];
  lastTrickTeam: 0 | 1 | null;
  handPoints: [number, number] | null;
  handScores: [number, number] | null;
  biddersSet: boolean | null;
};

export type GameState = {
  roomCode: string;
  phase: GamePhase;
  seatOrder: Seat[];
  playerOrder: string[];
  bidding: BiddingState;
  hand: HandState;
  whoseTurnSeat: Seat;
  whoseTurnPlayerId: string;
  scores: [number, number];
  dealerIndex: PlayerId;
};

export type GameStartSettings = {
  minBid?: number;
  step?: number;
  startingPlayer?: PlayerId;
  deckMode?: DeckMode;
};

export type GameAction =
  | { type: 'bid'; amount: number }
  | { type: 'pass' }
  | { type: 'passPartner' };

export type GameResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type Game = {
  state: GameState;
};

type KittyDiscardOutcome = {
  state: GameState;
  pointsNotice: boolean;
};

const KITTY_SIZE = 5;
const getSeatOrder = (): Seat[] => [...SEATS];

const buildPlayerOrder = (seats: Record<Seat, string | null>): GameResult<string[]> => {
  const order: string[] = [];
  for (const seat of SEATS) {
    const playerId = seats[seat];
    if (!playerId) {
      return { ok: false, error: 'seats not full' };
    }
    order.push(playerId);
  }
  return { ok: true, value: order };
};

const createSeed = (roomCode: string, startedAt: number): number => {
  const input = `${roomCode}:${startedAt}`;
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const dealHands = (roomCode: string, startedAt: number, deckMode: DeckMode) => {
  const seed = createSeed(roomCode, startedAt);
  const deck = shuffle(buildDeck(deckMode), mulberry32(seed));
  const { hands, kitty } = deal(deck, KITTY_SIZE);
  return { hands, kitty, seed };
};

const findPlayerIndex = (playerOrder: string[], playerId: string): GameResult<PlayerId> => {
  const index = playerOrder.indexOf(playerId);
  if (index === -1) {
    return { ok: false, error: 'player not seated' };
  }
  return { ok: true, value: index as PlayerId };
};

export const isRoomReadyForGame = (roomState: RoomState): GameResult<true> => {
  for (const seat of SEATS) {
    const playerId = roomState.seats[seat];
    if (!playerId) {
      return { ok: false, error: 'seats not full' };
    }
    if (!roomState.ready[playerId]) {
      return { ok: false, error: 'players not ready' };
    }
  }
  return { ok: true, value: true };
};

export const createGameState = (
  roomCode: string,
  seats: Record<Seat, string | null>,
  settings?: GameStartSettings,
): GameResult<GameState> => {
  const orderResult = buildPlayerOrder(seats);
  if (!orderResult.ok) return orderResult;

  const playerOrder = orderResult.value;
  const seatOrder = getSeatOrder();
  const dealerIndex = settings?.startingPlayer ?? 0;
  const bidding = createBiddingState(dealerIndex, settings?.minBid, settings?.step);
  const startedAt = Date.now();
  const deckMode = settings?.deckMode ?? 'full';
  const { hands, kitty, seed } = dealHands(roomCode, startedAt, deckMode);
  const hand: HandState = {
    phase: 'bidding',
    deckMode,
    startedAt,
    seed,
    kittySize: KITTY_SIZE,
    kitty,
    kittyPickedUpCards: [],
    pointsNoticeSent: false,
    hands,
    trickCards: [],
    trickLeadColor: undefined,
    bidder: null,
    winningBid: null,
    kittyPickedUp: false,
    capturedByTeam: [[], []],
    lastTrickTeam: null,
    handPoints: null,
    handScores: null,
    biddersSet: null,
  };
  const currentPlayerSeat = seatOrder[bidding.currentPlayer];
  const currentPlayerId = playerOrder[bidding.currentPlayer];

  return {
    ok: true,
    value: {
      roomCode,
      phase: 'bidding',
      seatOrder,
      playerOrder,
      bidding,
      hand,
      whoseTurnSeat: currentPlayerSeat,
      whoseTurnPlayerId: currentPlayerId,
      scores: [0, 0],
      dealerIndex,
    },
  };
};

export const reduceGameState = (
  state: GameState,
  playerId: string,
  action: GameAction,
): GameState => {
  const indexResult = findPlayerIndex(state.playerOrder, playerId);
  if (!indexResult.ok) {
    throw new Error(indexResult.error);
  }
  const playerIndex = indexResult.value;
  if (playerIndex !== state.bidding.currentPlayer) {
    throw new Error('Action must be taken by the current player.');
  }

  const biddingAction =
    action.type === 'bid'
      ? { type: 'bid', player: playerIndex, amount: action.amount }
      : action.type === 'pass'
        ? { type: 'pass', player: playerIndex }
        : { type: 'passPartner', player: playerIndex };

  const bidding = applyBiddingAction(state.bidding, biddingAction);
  let whoseTurnSeat = state.seatOrder[bidding.currentPlayer];
  let whoseTurnPlayerId = state.playerOrder[bidding.currentPlayer];
  let phase: GamePhase = state.phase;
  let hand = state.hand;

  if (isBiddingComplete(bidding)) {
    const winningBid = getWinningBid(bidding);
    const bidder = winningBid?.player ?? null;
    if (bidder !== null) {
      whoseTurnSeat = state.seatOrder[bidder];
      whoseTurnPlayerId = state.playerOrder[bidder];
    }
    phase = 'kitty';
    hand = {
      ...state.hand,
      phase,
      winningBid,
      bidder,
      kittyPickedUpCards: [],
      kittyPickedUp: false,
    };
  }

  return {
    ...state,
    phase,
    bidding,
    hand,
    whoseTurnSeat,
    whoseTurnPlayerId,
  };
};

const ensureBidder = (state: GameState, playerId: string): GameResult<PlayerId> => {
  if (state.hand.bidder === null) {
    return { ok: false, error: 'no winning bid' };
  }
  const bidderId = state.playerOrder[state.hand.bidder];
  if (bidderId !== playerId) {
    return { ok: false, error: 'only the bidder may act' };
  }
  return { ok: true, value: state.hand.bidder };
};

const removeCards = (hand: Card[], cards: Card[]): GameResult<Card[]> => {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const id = cardId(card);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const next: Card[] = [];
  for (const card of hand) {
    const id = cardId(card);
    const remaining = counts.get(id) ?? 0;
    if (remaining > 0) {
      counts.set(id, remaining - 1);
      continue;
    }
    next.push(card);
  }

  for (const remaining of counts.values()) {
    if (remaining > 0) {
      return { ok: false, error: 'discard cards missing from hand' };
    }
  }

  return { ok: true, value: next };
};

export class GameStore {
  private games = new Map<string, Game>();

  startGame(roomState: RoomState, settings?: GameStartSettings): GameResult<GameState> {
    const readyResult = isRoomReadyForGame(roomState);
    if (!readyResult.ok) return readyResult;

    const createResult = createGameState(roomState.roomCode, roomState.seats, settings);
    if (!createResult.ok) return createResult;

    this.games.set(roomState.roomCode, { state: createResult.value });
    return { ok: true, value: createResult.value };
  }

  applyAction(roomCode: string, playerId: string, action: GameAction): GameResult<GameState> {
    const game = this.games.get(roomCode);
    if (!game) {
      return { ok: false, error: 'game missing' };
    }

    try {
      const nextState = reduceGameState(game.state, playerId, action);
      game.state = nextState;
      return { ok: true, value: nextState };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid action';
      return { ok: false, error: message };
    }
  }

  pickupKitty(roomCode: string, playerId: string): GameResult<GameState> {
    const game = this.games.get(roomCode);
    if (!game) return { ok: false, error: 'game missing' };
    const { state } = game;
    if (state.phase !== 'kitty') return { ok: false, error: 'kitty not available' };

    const bidderResult = ensureBidder(state, playerId);
    if (!bidderResult.ok) return bidderResult;
    if (state.hand.kittyPickedUp) {
      return { ok: false, error: 'kitty already picked up' };
    }

    const bidderIndex = bidderResult.value;
    const hands = state.hand.hands.map((hand) => hand.slice());
    hands[bidderIndex] = [...hands[bidderIndex], ...state.hand.kitty];

    const nextState: GameState = {
      ...state,
      hand: {
        ...state.hand,
        hands,
        kitty: [],
        kittyPickedUpCards: state.hand.kitty.slice(),
        kittyPickedUp: true,
      },
    };

    game.state = nextState;
    return { ok: true, value: nextState };
  }

  discardKitty(
    roomCode: string,
    playerId: string,
    cards: Card[],
  ): GameResult<KittyDiscardOutcome> {
    const game = this.games.get(roomCode);
    if (!game) return { ok: false, error: 'game missing' };
    const { state } = game;
    if (state.phase !== 'kitty') return { ok: false, error: 'kitty not available' };

    const bidderResult = ensureBidder(state, playerId);
    if (!bidderResult.ok) return bidderResult;
    if (!state.hand.kittyPickedUp) {
      return { ok: false, error: 'kitty must be picked up first' };
    }
    if (cards.length !== state.hand.kittySize) {
      return { ok: false, error: 'discard must match kitty size' };
    }

    const bidderIndex = bidderResult.value;
    const currentHand = state.hand.hands[bidderIndex];
    const nextHandResult = removeCards(currentHand, cards);
    if (!nextHandResult.ok) return nextHandResult;

    const hands = state.hand.hands.map((hand) => hand.slice());
    hands[bidderIndex] = nextHandResult.value;

    const pointsInKitty = cards.some((card) => isPointCard(card));
    const pointsNotice = pointsInKitty && !state.hand.pointsNoticeSent;

    const nextState: GameState = {
      ...state,
      phase: 'declareTrump',
      whoseTurnSeat: state.seatOrder[bidderIndex],
      whoseTurnPlayerId: state.playerOrder[bidderIndex],
      hand: {
        ...state.hand,
        phase: 'declareTrump',
        kitty: cards.slice(),
        kittyPickedUpCards: [],
        pointsNoticeSent: state.hand.pointsNoticeSent || pointsInKitty,
        hands,
      },
    };

    game.state = nextState;
    return { ok: true, value: { state: nextState, pointsNotice } };
  }

  declareTrump(
    roomCode: string,
    playerId: string,
    trump: TrumpColor,
  ): GameResult<GameState> {
    const game = this.games.get(roomCode);
    if (!game) return { ok: false, error: 'game missing' };
    const { state } = game;
    if (state.phase !== 'declareTrump') return { ok: false, error: 'trump not ready' };

    const bidderResult = ensureBidder(state, playerId);
    if (!bidderResult.ok) return bidderResult;

    const bidderIndex = bidderResult.value;
    const nextState: GameState = {
      ...state,
      phase: 'trick',
      whoseTurnSeat: state.seatOrder[bidderIndex],
      whoseTurnPlayerId: state.playerOrder[bidderIndex],
      hand: {
        ...state.hand,
        phase: 'trick',
        trickCards: [],
        trickLeadColor: undefined,
        trump,
      },
    };

    game.state = nextState;
    return { ok: true, value: nextState };
  }

  playCard(roomCode: string, playerId: string, card: Card): GameResult<GameState> {
    const game = this.games.get(roomCode);
    if (!game) return { ok: false, error: 'game missing' };
    const { state } = game;
    if (state.phase !== 'trick') return { ok: false, error: 'trick not active' };
    if (state.whoseTurnPlayerId !== playerId) {
      return { ok: false, error: 'not your turn' };
    }

    const indexResult = findPlayerIndex(state.playerOrder, playerId);
    if (!indexResult.ok) return indexResult;
    const playerIndex = indexResult.value;

    const currentHand = state.hand.hands[playerIndex] ?? [];
    const trump = state.hand.trump;
    if (!trump) {
      return { ok: false, error: 'trump not set' };
    }
    const legalPlays = getLegalPlays(currentHand, state.hand.trickLeadColor, trump, 'rookHigh');
    if (!legalPlays.includes(cardId(card))) {
      return { ok: false, error: 'illegal play' };
    }

    const nextHandResult = removeCards(currentHand, [card]);
    if (!nextHandResult.ok) return nextHandResult;

    const hands = state.hand.hands.map((hand, index) =>
      index === playerIndex ? nextHandResult.value : hand.slice(),
    );

    const nextLeadColor =
      state.hand.trickLeadColor ?? (card.kind === 'suit' ? card.color : undefined);
    const nextTrickCards = [
      ...state.hand.trickCards,
      { seat: state.seatOrder[playerIndex], card },
    ];

    let trickCards = nextTrickCards;
    let trickLeadColor = nextLeadColor;
    let whoseTurnSeat = state.whoseTurnSeat;
    let whoseTurnPlayerId = state.whoseTurnPlayerId;
    let capturedByTeam = [
      state.hand.capturedByTeam[0].slice(),
      state.hand.capturedByTeam[1].slice(),
    ] as [Card[], Card[]];
    let lastTrickTeam = state.hand.lastTrickTeam;

    if (nextTrickCards.length >= state.seatOrder.length) {
      const winnerCardIndex = determineTrickWinner(
        nextTrickCards.map((entry) => entry.card),
        nextLeadColor,
        trump,
        'rookHigh',
      );
      const winnerSeat =
        nextTrickCards[winnerCardIndex]?.seat ?? state.seatOrder[playerIndex];
      const winnerIndex = state.seatOrder.indexOf(winnerSeat);
      const resolvedIndex = winnerIndex === -1 ? playerIndex : winnerIndex;
      const winningTeam = teamOf(resolvedIndex);
      capturedByTeam[winningTeam] = [
        ...capturedByTeam[winningTeam],
        ...nextTrickCards.map((entry) => entry.card),
      ];
      lastTrickTeam = winningTeam;
      whoseTurnSeat = state.seatOrder[resolvedIndex];
      whoseTurnPlayerId = state.playerOrder[resolvedIndex];
      trickCards = [];
      trickLeadColor = undefined;
    } else {
      const nextIndex = (playerIndex + 1) % state.seatOrder.length;
      whoseTurnSeat = state.seatOrder[nextIndex];
      whoseTurnPlayerId = state.playerOrder[nextIndex];
    }

    const handComplete =
      nextTrickCards.length >= state.seatOrder.length &&
      hands.every((hand) => hand.length === 0);

    let phase: GamePhase = state.phase;
    let handPhase: GamePhase = state.hand.phase;
    let scores = state.scores;
    let handPoints = state.hand.handPoints;
    let handScores = state.hand.handScores;
    let biddersSet = state.hand.biddersSet;

    if (handComplete) {
      const winningBid = state.hand.winningBid;
      const bidAmount = winningBid?.amount ?? 0;
      const biddingTeam = winningBid ? teamOf(winningBid.player) : 0;
      const resolvedLastTrickTeam = lastTrickTeam ?? biddingTeam;
      const scored = scoreHand(
        capturedByTeam,
        resolvedLastTrickTeam,
        state.hand.kitty,
        biddingTeam,
        bidAmount,
      );
      scores = [scores[0] + scored.scores[0], scores[1] + scored.scores[1]];
      handPoints = scored.points;
      handScores = scored.scores;
      biddersSet = scored.points[biddingTeam] < bidAmount;
      phase = 'score';
      handPhase = 'score';
    }

    const nextState: GameState = {
      ...state,
      phase,
      whoseTurnSeat,
      whoseTurnPlayerId,
      scores,
      hand: {
        ...state.hand,
        phase: handPhase,
        hands,
        trickCards,
        trickLeadColor,
        capturedByTeam,
        lastTrickTeam,
        handPoints,
        handScores,
        biddersSet,
      },
    };

    game.state = nextState;
    return { ok: true, value: nextState };
  }

  nextHand(roomCode: string): GameResult<GameState> {
    const game = this.games.get(roomCode);
    if (!game) return { ok: false, error: 'game missing' };
    const { state } = game;
    if (state.phase !== 'score') return { ok: false, error: 'hand not complete' };

    const dealerIndex = (((state.dealerIndex ?? 0) + 1) % 4) as PlayerId;
    const bidding = createBiddingState(dealerIndex, state.bidding.minBid, state.bidding.step);
    const startedAt = Date.now();
    const deckMode = state.hand.deckMode;
    const { hands, kitty, seed } = dealHands(roomCode, startedAt, deckMode);
    const hand: HandState = {
      phase: 'bidding',
      deckMode,
      startedAt,
      seed,
      kittySize: KITTY_SIZE,
      kitty,
      kittyPickedUpCards: [],
      pointsNoticeSent: false,
      hands,
      trickCards: [],
      trickLeadColor: undefined,
      bidder: null,
      winningBid: null,
      kittyPickedUp: false,
      capturedByTeam: [[], []],
      lastTrickTeam: null,
      handPoints: null,
      handScores: null,
      biddersSet: null,
    };
    const currentPlayerSeat = state.seatOrder[bidding.currentPlayer];
    const currentPlayerId = state.playerOrder[bidding.currentPlayer];
    const nextState: GameState = {
      ...state,
      phase: 'bidding',
      bidding,
      hand,
      whoseTurnSeat: currentPlayerSeat,
      whoseTurnPlayerId: currentPlayerId,
      dealerIndex,
    };

    game.state = nextState;
    return { ok: true, value: nextState };
  }

  getState(roomCode: string): GameState | null {
    return this.games.get(roomCode)?.state ?? null;
  }
}
