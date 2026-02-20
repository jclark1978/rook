import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardId, type Card } from '@rook/engine';
import type { DeckMode } from '@rook/engine';
import type { TrumpColor } from '@rook/engine';
import { GameStore, type GameState } from './game.js';
import { RoomStore, type RoomState } from './rooms.js';

const PORT = Number(process.env.PORT ?? 3001);
const DEFAULT_DEV_ORIGINS = [
  /^http:\/\/localhost:5173$/,
  /^http:\/\/127\.0\.0\.1:5173$/,
  /^http:\/\/skippy\.theclarks\.home:5173$/,
  /^http:\/\/(?:\d{1,3}\.){3}\d{1,3}:5173$/,
];
const ORIGIN = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean)
  : DEFAULT_DEV_ORIGINS;

const app = express();
app.use(cors({ origin: ORIGIN, credentials: true }));
app.get('/health', (_req, res) => res.json({ ok: true }));

if (process.env.NODE_ENV === 'production') {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const webDistPath = path.resolve(__dirname, '../../web/dist');
  app.use(express.static(webDistPath));
  app.get('*', (_req, res) => res.sendFile(path.join(webDistPath, 'index.html')));
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ORIGIN, credentials: true },
});

type RoomCreatePayload = {
  roomCode?: string;
  playerId?: string;
  playerName?: string;
  targetScore?: number;
};
type RoomJoinPayload = { roomCode: string; playerId?: string; playerName?: string };
type RoomSitPayload = { roomCode: string; seat: string };
type RoomLeavePayload = { roomCode: string };
type RoomClearSeatPayload = { roomCode: string; seat: string };
type RoomReadyPayload = { roomCode: string; ready: boolean };
type RoomAck =
  | { ok: true; roomCode: string; playerId: string; state: RoomState }
  | { ok: false; message: string };
type GameStartPayload = {
  roomCode: string;
  settings?: {
    minBid?: number;
    step?: number;
    deckMode?: DeckMode;
    rookRankMode?: 'rookHigh' | 'rookLow';
    targetScore?: number;
  };
};
type GameBidPayload = { roomCode: string; amount: number };
type GamePassPayload = { roomCode: string };
type GamePassPartnerPayload = { roomCode: string };
type GameDealPayload = {
  roomCode: string;
  rookRankMode?: 'rookHigh' | 'rookLow';
  includeLowCards?: boolean;
  deckMode?: DeckMode;
};
type KittyPickupPayload = { roomCode: string };
type KittyDiscardPayload = { roomCode: string; cards: Card[] };
type TrumpDeclarePayload = { roomCode: string; trump: TrumpColor };
type PlayCardPayload = { roomCode: string; card: Card };
type PlayUndoPayload = { roomCode: string };
type NextHandPayload = { roomCode: string };
type ScoreViewPayload = { roomCode: string };

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;

const generateRoomCode = () => {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
};

const rooms = new RoomStore();
const games = new GameStore();

const pendingRemovals = new Map<string, NodeJS.Timeout>();
const removalKey = (roomCode: string, playerId: string) => `${roomCode}:${playerId}`;
const DISCONNECT_SEAT_RELEASE_MS = 20_000;

const toGamePublicState = (state: GameState) => ({
  roomCode: state.roomCode,
  phase: state.phase,
  seatOrder: state.seatOrder,
  playerOrder: state.playerOrder,
  bidding: state.bidding,
  whoseTurnSeat: state.whoseTurnSeat,
  whoseTurnPlayerId: state.whoseTurnPlayerId,
  dealerSeat: state.seatOrder[state.dealerIndex] ?? null,
  rookRankMode: state.rookRankMode,
  deckMode: state.hand.deckMode,
  gameScores: state.scores,
  targetScore: state.targetScore,
  winnerTeam: state.winnerTeam,
});

const toHandPublicState = (state: GameState) => {
  const undoIndex = state.hand.undoAvailableForPlayerId
    ? state.playerOrder.indexOf(state.hand.undoAvailableForPlayerId)
    : -1;
  const undoAvailableForSeat = undoIndex >= 0 ? state.seatOrder[undoIndex] : null;

  return {
    roomCode: state.roomCode,
    phase: state.phase,
    trump: state.hand.trump,
    rookRankMode: state.rookRankMode,
    bidding: state.bidding,
    winningBid: state.hand.winningBid,
    bidderSeat: state.hand.bidder === null ? null : state.seatOrder[state.hand.bidder],
    dealerSeat: state.seatOrder[state.dealerIndex] ?? null,
    whoseTurnSeat: state.whoseTurnSeat,
    deckMode: state.hand.deckMode,
    handSizes: Object.fromEntries(
      state.seatOrder.map((seat, index) => [seat, state.hand.hands[index]?.length ?? 0]),
    ),
    kittyCount: state.hand.kitty.length,
    kittySize: state.hand.kittySize,
    trickCards: state.hand.trickCards,
    handPoints: state.hand.handPoints,
    biddersSet: state.hand.biddersSet,
    gameScores: state.scores,
    targetScore: state.targetScore,
    winnerTeam: state.winnerTeam,
    undoAvailableForSeat,
    handHistory: state.handHistory,
  };
};

const emitHandState = (roomCode: string, state: GameState) => {
  io.to(roomCode).emit('hand:state', toHandPublicState(state));
};

const emitGameState = (roomCode: string, state: GameState) => {
  io.to(roomCode).emit('game:state', toGamePublicState(state));
};

const connectedPlayerIdsInRoom = async (roomCode: string): Promise<Set<string>> => {
  const sockets = await io.in(roomCode).fetchSockets();
  const ids = new Set<string>();
  for (const roomSocket of sockets) {
    const pid = roomSocket.data.playerId;
    if (typeof pid === 'string' && pid.trim()) ids.add(pid);
  }
  return ids;
};

const emitPrivateHandToSocket = (roomSocket: { data: { playerId?: string }; emit: Function }, state: GameState) => {
  const playerId = roomSocket.data.playerId;
  if (!playerId) return;
  const playerIndex = state.playerOrder.indexOf(playerId);
  if (playerIndex === -1) return;
  const payload: { hand: Card[]; kitty?: Card[] } = {
    hand: state.hand.hands[playerIndex] ?? [],
  };
  if (state.hand.kittyPickedUp && state.hand.bidder === playerIndex && state.phase === 'kitty') {
    payload.kitty = state.hand.kittyPickedUpCards;
  }
  roomSocket.emit('hand:private', payload);
};

const emitPrivateHands = async (roomCode: string, state: GameState) => {
  const sockets = await io.in(roomCode).fetchSockets();
  for (const roomSocket of sockets) {
    emitPrivateHandToSocket(roomSocket as any, state);
  }
};

io.on('connection', (socket) => {
  const authPlayerId = (socket.handshake.auth as { playerId?: unknown } | undefined)?.playerId;
  if (typeof authPlayerId === 'string' && authPlayerId.trim()) {
    socket.data.playerId = authPlayerId;
  }

  socket.emit('server:hello', { ok: true, serverTime: Date.now() });

  socket.on('client:ping', () => {
    socket.emit('server:pong', { serverTime: Date.now() });
  });

  socket.on(
    'room:create',
    (
      { roomCode, playerId, playerName, targetScore }: RoomCreatePayload,
      ack?: (payload: RoomAck) => void,
    ) => {
      const resolvedPlayerId = socket.data.playerId ?? playerId ?? socket.id;
      socket.data.playerId = resolvedPlayerId;
      if (typeof playerName === 'string' && playerName.trim()) {
        socket.data.playerName = playerName.trim().slice(0, 24);
      }
      const requestedCode = roomCode?.trim().toUpperCase();

      let result = requestedCode
        ? rooms.createRoom(requestedCode, resolvedPlayerId, socket.data.playerName, targetScore)
        : { ok: false as const, error: 'room exists' };

      if (!requestedCode) {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const code = generateRoomCode();
          result = rooms.createRoom(code, resolvedPlayerId, socket.data.playerName, targetScore);
          if (result.ok || result.error !== 'room exists') {
            break;
          }
        }
      }

      if (!result.ok) {
        socket.emit('room:error', { message: result.error });
        ack?.({ ok: false, message: result.error });
        return;
      }

      socket.join(result.value.roomCode);
      io.to(result.value.roomCode).emit('room:state', result.value);
      ack?.({
        ok: true,
        roomCode: result.value.roomCode,
        playerId: resolvedPlayerId,
        state: result.value,
      });
    },
  );

  socket.on(
    'room:join',
    ({ roomCode, playerId, playerName }: RoomJoinPayload, ack?: (payload: RoomAck) => void) => {
      const resolvedPlayerId = socket.data.playerId ?? playerId ?? socket.id;
      socket.data.playerId = resolvedPlayerId;
      if (typeof playerName === 'string' && playerName.trim()) {
        socket.data.playerName = playerName.trim().slice(0, 24);
      }
      const normalizedCode = roomCode.trim().toUpperCase();

      // Cancel any pending seat release for this player.
      const key = removalKey(normalizedCode, resolvedPlayerId);
      const pending = pendingRemovals.get(key);
      if (pending) {
        clearTimeout(pending);
        pendingRemovals.delete(key);
      }

      const result = rooms.joinRoom(normalizedCode, resolvedPlayerId, socket.data.playerName);
      if (!result.ok) {
        socket.emit('room:error', { message: result.error });
        ack?.({ ok: false, message: result.error });
        return;
      }

      socket.join(result.value.roomCode);
      io.to(result.value.roomCode).emit('room:state', result.value);
      ack?.({
        ok: true,
        roomCode: result.value.roomCode,
        playerId: resolvedPlayerId,
        state: result.value,
      });

      // If a game is already in progress, immediately sync the joining socket.
      // Also: if exactly one seat is open, auto-seat them into it.
      const gameState = games.getState(normalizedCode);
      if (gameState) {
        const openSeats = Object.entries(result.value.seats)
          .filter(([, occupant]) => !occupant)
          .map(([seat]) => seat);
        if (openSeats.length === 1) {
          const seat = openSeats[0] as string;
          const sitResult = rooms.sit(normalizedCode, resolvedPlayerId, seat);
          if (sitResult.ok) {
            io.to(normalizedCode).emit('room:state', sitResult.value);
            if (seat === 'T1P1' || seat === 'T2P1' || seat === 'T1P2' || seat === 'T2P2') {
              const rebound = games.rebindSeat(normalizedCode, seat, resolvedPlayerId);
              if (rebound.ok) {
                socket.emit('game:state', toGamePublicState(rebound.value));
                socket.emit('hand:state', toHandPublicState(rebound.value));
                emitPrivateHandToSocket(socket as any, rebound.value);
              }
            }
          }
        } else {
          socket.emit('game:state', toGamePublicState(gameState));
          socket.emit('hand:state', toHandPublicState(gameState));
          emitPrivateHandToSocket(socket as any, gameState);
        }
      }
    },
  );

  socket.on('room:sit', ({ roomCode, seat }: RoomSitPayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const normalizedCode = roomCode.trim().toUpperCase();

    // Cancel any pending seat release for this player.
    const key = removalKey(normalizedCode, resolvedPlayerId);
    const pending = pendingRemovals.get(key);
    if (pending) {
      clearTimeout(pending);
      pendingRemovals.delete(key);
    }

    const result = rooms.sit(normalizedCode, resolvedPlayerId, seat);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }

    // If a game is in progress, rebind that seat to this player id.
    const gameState = games.getState(normalizedCode);
    if (gameState && (seat === 'T1P1' || seat === 'T2P1' || seat === 'T1P2' || seat === 'T2P2')) {
      const rebound = games.rebindSeat(normalizedCode, seat, resolvedPlayerId);
      if (rebound.ok) {
        emitGameState(normalizedCode, rebound.value);
        emitHandState(normalizedCode, rebound.value);
        emitPrivateHandToSocket(socket as any, rebound.value);
      }
    }

    io.to(normalizedCode).emit('room:state', result.value);
  });

  socket.on('room:leave', ({ roomCode }: RoomLeavePayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const normalizedCode = roomCode.trim().toUpperCase();
    const result = rooms.leaveSeat(normalizedCode, resolvedPlayerId);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }

    io.to(normalizedCode).emit('room:state', result.value);
  });

  socket.on('room:clearSeat', async ({ roomCode, seat }: RoomClearSeatPayload) => {
    const normalizedCode = roomCode.trim().toUpperCase();
    const roomState = rooms.getRoomState(normalizedCode);
    if (!roomState) {
      socket.emit('room:error', { message: 'room missing' });
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(roomState.seats, seat)) {
      socket.emit('room:error', { message: 'invalid seat' });
      return;
    }

    const seatKey = seat as keyof typeof roomState.seats;
    const occupant = roomState.seats[seatKey] ?? null;
    if (!occupant) {
      // already open
      return;
    }

    const connected = await connectedPlayerIdsInRoom(normalizedCode);
    if (connected.has(occupant)) {
      socket.emit('room:error', { message: 'player still connected' });
      return;
    }

    const cleared = rooms.removePlayer(normalizedCode, occupant);
    if (!cleared.ok) {
      socket.emit('room:error', { message: cleared.error });
      return;
    }

    io.to(normalizedCode).emit('room:state', cleared.value);

    // Note: we do not mutate the active game state here. If the dropped seat was the current turn,
    // the hand is effectively paused until someone takes the seat. When a new player sits,
    // the server will rebind the seat in the active game.
  });

  socket.on('room:ready', ({ roomCode, ready }: RoomReadyPayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const result = rooms.setReady(roomCode, resolvedPlayerId, ready);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }

    io.to(roomCode).emit('room:state', result.value);
  });

  socket.on('game:start', async ({ roomCode, settings }: GameStartPayload) => {
    const normalizedCode = roomCode.trim().toUpperCase();
    const roomState = rooms.getRoomState(normalizedCode);
    if (!roomState) {
      socket.emit('game:error', { message: 'room missing' });
      return;
    }

    const result = games.startGame(roomState, {
      ...settings,
      targetScore: roomState.targetScore,
    });
    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }

    emitGameState(normalizedCode, result.value);
    emitHandState(normalizedCode, result.value);
    await emitPrivateHands(normalizedCode, result.value);
  });

  socket.on('game:deal', async ({ roomCode, rookRankMode, includeLowCards, deckMode }: GameDealPayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const normalizedCode = roomCode.trim().toUpperCase();
    const deckModeFromToggle: DeckMode | undefined =
      typeof includeLowCards === 'boolean'
        ? includeLowCards
          ? 'full'
          : 'fast'
        : undefined;
    const deckModeFromPayload: DeckMode | undefined =
      deckMode === 'full' || deckMode === 'fast' ? deckMode : undefined;
    const resolvedDeckMode: DeckMode | undefined = deckModeFromToggle ?? deckModeFromPayload;
    const result = games.dealHand(normalizedCode, resolvedPlayerId, rookRankMode, resolvedDeckMode);
    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }

    emitGameState(normalizedCode, result.value);
    emitHandState(normalizedCode, result.value);
    await emitPrivateHands(normalizedCode, result.value);
  });

  socket.on('game:bid', async ({ roomCode, amount }: GameBidPayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const normalizedCode = roomCode.trim().toUpperCase();
    const result = games.applyAction(normalizedCode, resolvedPlayerId, { type: 'bid', amount });
    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }

    emitGameState(normalizedCode, result.value);
    emitHandState(normalizedCode, result.value);
    await emitPrivateHands(normalizedCode, result.value);
  });

  socket.on('game:pass', async ({ roomCode }: GamePassPayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const normalizedCode = roomCode.trim().toUpperCase();
    const result = games.applyAction(normalizedCode, resolvedPlayerId, { type: 'pass' });
    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }

    emitGameState(normalizedCode, result.value);
    emitHandState(normalizedCode, result.value);
    await emitPrivateHands(normalizedCode, result.value);
  });

  socket.on('game:passPartner', async ({ roomCode }: GamePassPartnerPayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const normalizedCode = roomCode.trim().toUpperCase();
    const result = games.applyAction(normalizedCode, resolvedPlayerId, { type: 'passPartner' });
    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }

    emitGameState(normalizedCode, result.value);
    emitHandState(normalizedCode, result.value);
    await emitPrivateHands(normalizedCode, result.value);
  });

  socket.on('kitty:pickup', async ({ roomCode }: KittyPickupPayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const normalizedCode = roomCode.trim().toUpperCase();
    const result = games.pickupKitty(normalizedCode, resolvedPlayerId);
    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }

    emitGameState(normalizedCode, result.value);
    emitHandState(normalizedCode, result.value);
    await emitPrivateHands(normalizedCode, result.value);
  });

  socket.on('kitty:discard', async ({ roomCode, cards }: KittyDiscardPayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const normalizedCode = roomCode.trim().toUpperCase();
    const result = games.discardKitty(normalizedCode, resolvedPlayerId, cards);
    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }

    if (result.value.pointsNotice) {
      io.to(normalizedCode).emit('info:notice', { text: 'There are points in the kitty' });
    }

    emitGameState(normalizedCode, result.value.state);
    emitHandState(normalizedCode, result.value.state);
    await emitPrivateHands(normalizedCode, result.value.state);
  });

  socket.on('trump:declare', ({ roomCode, trump }: TrumpDeclarePayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const normalizedCode = roomCode.trim().toUpperCase();
    const result = games.declareTrump(normalizedCode, resolvedPlayerId, trump);
    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }

    emitGameState(normalizedCode, result.value);
    emitHandState(normalizedCode, result.value);
  });

  socket.on('play:card', async ({ roomCode, card }: PlayCardPayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const normalizedCode = roomCode.trim().toUpperCase();
    // Helps trace trick-phase play issues end-to-end.
    console.info('[server] play:card', {
      roomCode: normalizedCode,
      playerId: resolvedPlayerId,
      card: cardId(card),
    });
    const result = games.playCard(normalizedCode, resolvedPlayerId, card);
    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }

    emitHandState(normalizedCode, result.value);
    await emitPrivateHands(normalizedCode, result.value);
  });

  socket.on('play:undo', async ({ roomCode }: PlayUndoPayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const normalizedCode = roomCode.trim().toUpperCase();
    const result = games.undoPlay(normalizedCode, resolvedPlayerId);
    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }

    emitHandState(normalizedCode, result.value);
    await emitPrivateHands(normalizedCode, result.value);
  });

  socket.on('next:hand', async ({ roomCode }: NextHandPayload) => {
    const normalizedCode = roomCode.trim().toUpperCase();
    const result = games.nextHand(normalizedCode);
    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }

    emitGameState(normalizedCode, result.value);
    emitHandState(normalizedCode, result.value);
    await emitPrivateHands(normalizedCode, result.value);
  });

  socket.on('score:view', ({ roomCode }: ScoreViewPayload) => {
    const normalizedCode = roomCode.trim().toUpperCase();
    const state = games.getState(normalizedCode);
    if (!state) {
      socket.emit('game:error', { message: 'game missing' });
      return;
    }
    if (state.phase !== 'score' && state.phase !== 'gameOver') {
      socket.emit('game:error', { message: 'scores not ready' });
      return;
    }
    io.to(normalizedCode).emit('score:view', { roomCode: normalizedCode });
  });

  socket.on('disconnect', () => {
    const playerId = socket.data.playerId ?? socket.id;
    for (const room of socket.rooms) {
      if (room === socket.id) continue;
      const roomCode = String(room);
      const key = removalKey(roomCode, playerId);
      if (pendingRemovals.has(key)) continue;

      const timeout = setTimeout(() => {
        pendingRemovals.delete(key);
        const result = rooms.removePlayer(roomCode, playerId);
        if (result.ok) {
          io.to(roomCode).emit('room:state', result.value);
        }
      }, DISCONNECT_SEAT_RELEASE_MS);

      pendingRemovals.set(key, timeout);
    }
  });
});

const HOST = process.env.HOST ?? '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://${HOST}:${PORT}`);
});
