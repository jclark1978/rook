import {
  applyBiddingAction,
  createBiddingState,
  DEFAULT_MIN_BID,
  type BiddingState,
  type Bid,
  getWinningBid,
  isBiddingComplete,
  type PlayerId,
  teamOf,
} from '@rook/engine/src/bidding.js';
import type { Card } from '@rook/engine/src/cards.js';
import { cardId, isPointCard } from '@rook/engine/src/cards.js';
import type { DeckMode, RookRankMode } from '@rook/engine/src/index.js';
import { buildDeck, deal, mulberry32, shuffle } from '@rook/engine/src/deck.js';
import { scoreHand } from '@rook/engine/src/scoring.js';
import { determineTrickWinner, getLegalPlays, type TrumpColor } from '@rook/engine/src/trick.js';
import { SEATS, type RoomState, type Seat } from './rooms.js';

export type GamePhase =
  | 'preDeal'
  | 'bidding'
  | 'kitty'
  | 'declareTrump'
  | 'trick'
  | 'score'
  | 'gameOver';

export type HandState = {
  phase: GamePhase;
  deckMode: DeckMode;
  dealerSeat: Seat;
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
  capturedByTeam: { T1: Card[]; T2: Card[] };
  lastTrickWinnerTeam: 'T1' | 'T2' | null;
  handPoints: [number, number] | null;
  handScores: [number, number] | null;
  biddersSet: boolean | null;
  // Misclick takeback: if set, only this player may undo, and only until the next action.
  undoAvailableForPlayerId: string | null;
  undoState: GameState | null;
};

export type GameState = {
  roomCode: string;
  phase: GamePhase;
  seatOrder: Seat[];
  playerOrder: string[];
  dealerSeat: Seat;
  rookRankMode: RookRankMode;
  bidding: BiddingState;
  hand: HandState;
  whoseTurnSeat: Seat;
  whoseTurnPlayerId: string;
  scores: [number, number];
  // Alias used by tests/UI
  gameScore: [number, number];
  dealerIndex: PlayerId;
  targetScore: number;
  winnerTeam: 0 | 1 | null;
};

export type GameStartSettings = {
  minBid?: number;
  step?: number;
  startingPlayer?: PlayerId;
  deckMode?: DeckMode;
  rookRankMode?: RookRankMode;
  targetScore?: number;
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

const teamKey = (team: 0 | 1): 'T1' | 'T2' => (team === 0 ? 'T1' : 'T2');

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
  const dealerSeat = seatOrder[dealerIndex];
  const firstBidder = (((dealerIndex + 1) % 4) as PlayerId);
  const bidding = createBiddingState(firstBidder, settings?.minBid, settings?.step);
  const startedAt = Date.now();
  const deckMode = settings?.deckMode ?? 'full';
  const rookRankMode = settings?.rookRankMode ?? 'rookHigh';
  const targetScore = settings?.targetScore ?? 700;
  const { hands, kitty, seed } = dealHands(roomCode, startedAt, deckMode);
  const hand: HandState = {
    phase: 'bidding',
    deckMode,
    dealerSeat,
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
    capturedByTeam: { T1: [], T2: [] },
    lastTrickWinnerTeam: null,
    handPoints: null,
    handScores: null,
    biddersSet: null,
    undoAvailableForPlayerId: null,
    undoState: null,
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
      dealerSeat,
      rookRankMode,
      bidding,
      hand,
      whoseTurnSeat: currentPlayerSeat,
      whoseTurnPlayerId: currentPlayerId,
      scores: [0, 0],
      gameScore: [0, 0],
      dealerIndex,
      targetScore,
      winnerTeam: null,
    },
  };
};

const createPreDealState = (
  roomCode: string,
  seats: Record<Seat, string | null>,
  settings?: GameStartSettings,
): GameResult<GameState> => {
  const orderResult = buildPlayerOrder(seats);
  if (!orderResult.ok) return orderResult;

  const playerOrder = orderResult.value;
  const seatOrder = getSeatOrder();
  const dealerIndex = settings?.startingPlayer ?? 0;
  const dealerSeat = seatOrder[dealerIndex];
  const bidding = createBiddingState((((dealerIndex + 1) % 4) as PlayerId), settings?.minBid, settings?.step);
  const deckMode = settings?.deckMode ?? 'full';
  const rookRankMode = settings?.rookRankMode ?? 'rookHigh';
  const targetScore = settings?.targetScore ?? 700;
  const hand: HandState = {
    phase: 'preDeal',
    deckMode,
    dealerSeat,
    startedAt: Date.now(),
    seed: 0,
    kittySize: KITTY_SIZE,
    kitty: [],
    kittyPickedUpCards: [],
    pointsNoticeSent: false,
    hands: [[], [], [], []],
    trickCards: [],
    trickLeadColor: undefined,
    bidder: null,
    winningBid: null,
    kittyPickedUp: false,
    capturedByTeam: { T1: [], T2: [] },
    lastTrickWinnerTeam: null,
    handPoints: null,
    handScores: null,
    biddersSet: null,
    undoAvailableForPlayerId: null,
    undoState: null,
  };

  return {
    ok: true,
    value: {
      roomCode,
      phase: 'preDeal',
      seatOrder,
      playerOrder,
      dealerSeat,
      rookRankMode,
      bidding,
      hand,
      // In preDeal, dealer controls setup and deal.
      whoseTurnSeat: dealerSeat,
      whoseTurnPlayerId: playerOrder[dealerIndex],
      scores: [0, 0],
      gameScore: [0, 0],
      dealerIndex,
      targetScore,
      winnerTeam: null,
    },
  };
};

const dealCurrentHand = (state: GameState, rookRankMode: RookRankMode): GameState => {
  const startedAt = Date.now();
  const { hands, kitty, seed } = dealHands(state.roomCode, startedAt, state.hand.deckMode);
  const bidding = createBiddingState(
    (((state.dealerIndex + 1) % 4) as PlayerId),
    state.bidding.minBid,
    state.bidding.step,
  );
  const currentPlayerSeat = state.seatOrder[bidding.currentPlayer];
  const currentPlayerId = state.playerOrder[bidding.currentPlayer];

  return {
    ...state,
    phase: 'bidding',
    rookRankMode,
    bidding,
    whoseTurnSeat: currentPlayerSeat,
    whoseTurnPlayerId: currentPlayerId,
    hand: {
      ...state.hand,
      phase: 'bidding',
      startedAt,
      seed,
      kitty,
      kittyPickedUpCards: [],
      pointsNoticeSent: false,
      hands,
      trickCards: [],
      trickLeadColor: undefined,
      bidder: null,
      winningBid: null,
      trump: undefined,
      kittyPickedUp: false,
      capturedByTeam: { T1: [], T2: [] },
      lastTrickWinnerTeam: null,
      handPoints: null,
      handScores: null,
      biddersSet: null,
      undoAvailableForPlayerId: null,
      undoState: null,
    },
    winnerTeam: null,
  };
};

export const reduceGameState = (
  state: GameState,
  playerId: string,
  action: GameAction,
): GameState => {
  if (state.phase !== 'bidding') {
    throw new Error('bidding not active');
  }
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
  let resolvedBidding = bidding;
  let whoseTurnSeat = state.seatOrder[bidding.currentPlayer];
  let whoseTurnPlayerId = state.playerOrder[bidding.currentPlayer];
  let phase: GamePhase = state.phase;
  let hand = state.hand;

  if (isBiddingComplete(bidding)) {
    const fallbackDealerBid: Bid = {
      player: state.dealerIndex,
      amount: DEFAULT_MIN_BID,
    };
    const winningBid = getWinningBid(bidding) ?? fallbackDealerBid;
    resolvedBidding = bidding.highBid
      ? bidding
      : {
          ...bidding,
          highBid: fallbackDealerBid,
        };
    const bidder = winningBid?.player ?? null;
    if (bidder !== null) {
      whoseTurnSeat = state.seatOrder[bidder];
      whoseTurnPlayerId = state.playerOrder[bidder];
    }

    // Auto-pickup kitty: bidder receives kitty cards immediately.
    const kittyPickedUpCards = bidder === null ? [] : state.hand.kitty.slice();
    const hands = state.hand.hands.map((h) => h.slice());
    if (bidder !== null) {
      hands[bidder] = [...hands[bidder], ...kittyPickedUpCards];
    }

    phase = 'kitty';
    hand = {
      ...state.hand,
      phase,
      winningBid,
      bidder,
      hands,
      kitty: [],
      kittyPickedUpCards,
      kittyPickedUp: bidder !== null,
      undoAvailableForPlayerId: null,
      undoState: null,
    };
  }

  return {
    ...state,
    phase,
    bidding: resolvedBidding,
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

  rebindSeat(roomCode: string, seat: Seat, newPlayerId: string): GameResult<GameState> {
    const game = this.games.get(roomCode);
    if (!game) return { ok: false, error: 'game missing' };

    const { state } = game;
    const index = state.seatOrder.indexOf(seat);
    if (index === -1) return { ok: false, error: 'invalid seat' };

    const playerOrder = state.playerOrder.slice();
    playerOrder[index] = newPlayerId;

    const whoseTurnPlayerId = state.whoseTurnSeat === seat ? newPlayerId : state.whoseTurnPlayerId;

    const nextState: GameState = {
      ...state,
      playerOrder,
      whoseTurnPlayerId,
    };

    game.state = nextState;
    return { ok: true, value: nextState };
  }

  startGame(roomState: RoomState, settings?: GameStartSettings): GameResult<GameState> {
    const readyResult = isRoomReadyForGame(roomState);
    if (!readyResult.ok) return readyResult;

    const createResult = createPreDealState(roomState.roomCode, roomState.seats, settings);
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

  dealHand(
    roomCode: string,
    playerId: string,
    rookRankMode?: RookRankMode,
  ): GameResult<GameState> {
    const game = this.games.get(roomCode);
    if (!game) return { ok: false, error: 'game missing' };
    const { state } = game;
    if (state.phase !== 'preDeal') return { ok: false, error: 'deal not ready' };
    const dealerPlayerId = state.playerOrder[state.dealerIndex];
    if (dealerPlayerId !== playerId) return { ok: false, error: 'only dealer may deal' };
    const mode = rookRankMode ?? state.rookRankMode;
    if (mode !== 'rookHigh' && mode !== 'rookLow') {
      return { ok: false, error: 'invalid rook rank mode' };
    }
    const nextState = dealCurrentHand(state, mode);
    game.state = nextState;
    return { ok: true, value: nextState };
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
        undoAvailableForPlayerId: null,
        undoState: null,
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
        undoAvailableForPlayerId: null,
        undoState: null,
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
        undoAvailableForPlayerId: null,
        undoState: null,
      },
    };

    game.state = nextState;
    return { ok: true, value: nextState };
  }

  undoPlay(roomCode: string, playerId: string): GameResult<GameState> {
    const game = this.games.get(roomCode);
    if (!game) return { ok: false, error: 'game missing' };
    const { state } = game;

    const undoAvailableFor = state.hand.undoAvailableForPlayerId;
    const undoState = state.hand.undoState;
    if (!undoAvailableFor || !undoState) {
      return { ok: false, error: 'no undo available' };
    }
    if (undoAvailableFor !== playerId) {
      return { ok: false, error: 'only the last player may undo' };
    }

    // Disallow undo if the game has advanced past trick play (e.g., scoring).
    if (state.phase !== 'trick') {
      return { ok: false, error: 'undo window closed' };
    }

    // If the last action completed a trick (trickCards cleared), don't allow undo.
    // This keeps capture tracking and last-trick logic simple and prevents rewinding trick resolution.
    if (state.hand.trickCards.length === 0) {
      return { ok: false, error: 'undo window closed' };
    }

    // Restore the previous state and clear undo.
    const restored: GameState = {
      ...undoState,
      hand: {
        ...undoState.hand,
        undoAvailableForPlayerId: null,
        undoState: null,
      },
    };

    game.state = restored;
    return { ok: true, value: restored };
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

    // Keep completed trick cards visible until the winner leads the next trick.
    // Before validating/playing that lead, clear the previous trick context.
    const trickNeedsReset = state.hand.trickCards.length >= state.seatOrder.length;
    const effectiveTrickCards = trickNeedsReset ? [] : state.hand.trickCards;
    const effectiveTrickLeadColor = trickNeedsReset ? undefined : state.hand.trickLeadColor;

    const currentHand = state.hand.hands[playerIndex] ?? [];
    const trump = state.hand.trump;
    if (!trump) {
      return { ok: false, error: 'trump not set' };
    }
    const legalPlays = getLegalPlays(
      currentHand,
      effectiveTrickLeadColor,
      trump,
      state.rookRankMode,
    );
    if (!legalPlays.includes(cardId(card))) {
      return { ok: false, error: 'illegal play' };
    }

    const nextHandResult = removeCards(currentHand, [card]);
    if (!nextHandResult.ok) return nextHandResult;

    const hands = state.hand.hands.map((hand, index) =>
      index === playerIndex ? nextHandResult.value : hand.slice(),
    );

    const nextLeadColor =
      effectiveTrickLeadColor ??
      (card.kind === 'suit' ? card.color : card.kind === 'rook' ? trump : undefined);
    const nextTrickCards = [
      ...effectiveTrickCards,
      { seat: state.seatOrder[playerIndex], card },
    ];

    let trickCards = nextTrickCards;
    let trickLeadColor = nextLeadColor;
    let whoseTurnSeat = state.whoseTurnSeat;
    let whoseTurnPlayerId = state.whoseTurnPlayerId;
    let capturedByTeam = {
      T1: state.hand.capturedByTeam.T1.slice(),
      T2: state.hand.capturedByTeam.T2.slice(),
    };
    let lastTrickWinnerTeam = state.hand.lastTrickWinnerTeam;

    if (nextTrickCards.length >= state.seatOrder.length) {
      const winnerCardIndex = determineTrickWinner(
        nextTrickCards.map((entry) => entry.card),
        nextLeadColor,
        trump,
        state.rookRankMode,
      );
      const winnerSeat =
        nextTrickCards[winnerCardIndex]?.seat ?? state.seatOrder[playerIndex];
      const winnerIndex = state.seatOrder.indexOf(winnerSeat);
      const resolvedIndex = winnerIndex === -1 ? playerIndex : winnerIndex;
      const winningTeam = teamOf(resolvedIndex);
      const key = teamKey(winningTeam);
      capturedByTeam[key] = [
        ...capturedByTeam[key],
        ...nextTrickCards.map((entry) => entry.card),
      ];
      lastTrickWinnerTeam = key;
      whoseTurnSeat = state.seatOrder[resolvedIndex];
      whoseTurnPlayerId = state.playerOrder[resolvedIndex];
      // Keep the completed trick visible until the winner leads the next trick.
      trickCards = nextTrickCards;
      trickLeadColor = nextLeadColor;
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
      const resolvedLastTrickTeam =
        lastTrickWinnerTeam === null ? teamKey(biddingTeam) : lastTrickWinnerTeam;
      const scored = scoreHand(
        [capturedByTeam.T1, capturedByTeam.T2],
        resolvedLastTrickTeam === 'T1' ? 0 : 1,
        state.hand.kitty,
        biddingTeam,
        bidAmount,
      );
      scores = [scores[0] + scored.scores[0], scores[1] + scored.scores[1]];
      handPoints = scored.points;
      handScores = scored.scores;
      biddersSet = scored.points[biddingTeam] < bidAmount;
      const winnerTeam = scores[0] >= state.targetScore ? 0 : scores[1] >= state.targetScore ? 1 : null;
      phase = winnerTeam === null ? 'score' : 'gameOver';
      handPhase = phase;
    }

    const trickCompleted = nextTrickCards.length >= state.seatOrder.length;
    const undoAllowed = !trickCompleted && trickCards.length > 0 && phase === 'trick';

    const nextState: GameState = {
      ...state,
      phase,
      whoseTurnSeat,
      whoseTurnPlayerId,
      scores,
      gameScore: scores,
      winnerTeam: scores[0] >= state.targetScore ? 0 : scores[1] >= state.targetScore ? 1 : null,
      hand: {
        ...state.hand,
        phase: handPhase,
        hands,
        trickCards,
        trickLeadColor,
        capturedByTeam,
        lastTrickWinnerTeam,
        handPoints,
        handScores,
        biddersSet,
        // Undo is only available for the last play, until the next player acts.
        undoAvailableForPlayerId: undoAllowed ? playerId : null,
        undoState: undoAllowed
          ? {
              ...state,
              hand: {
                ...state.hand,
                undoAvailableForPlayerId: null,
                undoState: null,
              },
            }
          : null,
      },
    };

    game.state = nextState;
    return { ok: true, value: nextState };
  }

  nextHand(roomCode: string): GameResult<GameState> {
    const game = this.games.get(roomCode);
    if (!game) return { ok: false, error: 'game missing' };
    const { state } = game;
    if (state.phase === 'gameOver') return { ok: false, error: 'game complete' };
    if (state.phase !== 'score') return { ok: false, error: 'hand not complete' };

    const dealerIndex = (((state.dealerIndex ?? 0) + 1) % 4) as PlayerId;
    const dealerSeat = state.seatOrder[dealerIndex];
    const bidding = createBiddingState(
      (((dealerIndex + 1) % 4) as PlayerId),
      state.bidding.minBid,
      state.bidding.step,
    );
    const hand: HandState = {
      phase: 'preDeal',
      deckMode: state.hand.deckMode,
      dealerSeat,
      startedAt: Date.now(),
      seed: 0,
      kittySize: KITTY_SIZE,
      kitty: [],
      kittyPickedUpCards: [],
      pointsNoticeSent: false,
      hands: [[], [], [], []],
      trickCards: [],
      trickLeadColor: undefined,
      bidder: null,
      winningBid: null,
      kittyPickedUp: false,
      capturedByTeam: { T1: [], T2: [] },
      lastTrickWinnerTeam: null,
      handPoints: null,
      handScores: null,
      biddersSet: null,
      undoAvailableForPlayerId: null,
      undoState: null,
    };
    const nextState: GameState = {
      ...state,
      phase: 'preDeal',
      dealerSeat,
      bidding,
      hand,
      // Dealer chooses rook mode and starts the deal.
      whoseTurnSeat: dealerSeat,
      whoseTurnPlayerId: state.playerOrder[dealerIndex],
      dealerIndex,
      // keep rookRankMode across hands
      rookRankMode: state.rookRankMode,
      targetScore: state.targetScore,
      winnerTeam: null,
    };

    game.state = nextState;
    return { ok: true, value: nextState };
  }

  getState(roomCode: string): GameState | null {
    return this.games.get(roomCode)?.state ?? null;
  }
}
