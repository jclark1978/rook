import {
  applyBiddingAction,
  createBiddingState,
  type BiddingState,
  type PlayerId,
} from '@rook/engine/src/bidding.js';
import { SEATS, type RoomState, type Seat } from './rooms.js';

export type GamePhase = 'bidding';

export type GameState = {
  roomCode: string;
  phase: GamePhase;
  seatOrder: Seat[];
  playerOrder: string[];
  bidding: BiddingState;
  whoseTurnSeat: Seat;
  whoseTurnPlayerId: string;
};

export type GameStartSettings = {
  minBid?: number;
  step?: number;
  startingPlayer?: PlayerId;
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
  const bidding = createBiddingState(
    settings?.startingPlayer ?? 0,
    settings?.minBid,
    settings?.step,
  );
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
      whoseTurnSeat: currentPlayerSeat,
      whoseTurnPlayerId: currentPlayerId,
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
  const whoseTurnSeat = state.seatOrder[bidding.currentPlayer];
  const whoseTurnPlayerId = state.playerOrder[bidding.currentPlayer];

  return {
    ...state,
    bidding,
    whoseTurnSeat,
    whoseTurnPlayerId,
  };
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

  getState(roomCode: string): GameState | null {
    return this.games.get(roomCode)?.state ?? null;
  }
}
