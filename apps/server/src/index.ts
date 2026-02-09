import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { cardId, type Card } from '@rook/engine/src/cards.js';
import type { DeckMode } from '@rook/engine/src/index.js';
import type { TrumpColor } from '@rook/engine/src/trick.js';
import { GameStore, type GameState } from './game.js';
import { RoomStore, type RoomState } from './rooms.js';

const PORT = Number(process.env.PORT ?? 3001);
const ORIGIN = process.env.CORS_ORIGIN ?? [/^http:\/\/localhost:5173$/, /^http:\/\/skippy\.theclarks\.home:5173$/];

const app = express();
app.use(cors({ origin: ORIGIN, credentials: true }));
app.get('/health', (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ORIGIN, credentials: true },
});

type RoomCreatePayload = { roomCode?: string; playerId?: string };
type RoomJoinPayload = { roomCode: string };
type RoomSitPayload = { roomCode: string; seat: string };
type RoomReadyPayload = { roomCode: string; ready: boolean };
type RoomAck =
  | { ok: true; roomCode: string; playerId: string; state: RoomState }
  | { ok: false; message: string };
type GameStartPayload = {
  roomCode: string;
  settings?: { minBid?: number; step?: number; deckMode?: DeckMode };
};
type GameBidPayload = { roomCode: string; amount: number };
type GamePassPayload = { roomCode: string };
type GamePassPartnerPayload = { roomCode: string };
type KittyPickupPayload = { roomCode: string };
type KittyDiscardPayload = { roomCode: string; cards: Card[] };
type TrumpDeclarePayload = { roomCode: string; trump: TrumpColor };
type PlayCardPayload = { roomCode: string; card: Card };
type NextHandPayload = { roomCode: string };

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

const toGamePublicState = (state: GameState) => ({
  roomCode: state.roomCode,
  phase: state.phase,
  seatOrder: state.seatOrder,
  playerOrder: state.playerOrder,
  bidding: state.bidding,
  whoseTurnSeat: state.whoseTurnSeat,
  whoseTurnPlayerId: state.whoseTurnPlayerId,
  dealerSeat: state.seatOrder[state.dealerIndex] ?? null,
  gameScores: state.scores,
});

const toHandPublicState = (state: GameState) => ({
  roomCode: state.roomCode,
  phase: state.phase,
  trump: state.hand.trump,
  bidding: state.bidding,
  winningBid: state.hand.winningBid,
  bidderSeat: state.hand.bidder === null ? null : state.seatOrder[state.hand.bidder],
  dealerSeat: state.seatOrder[state.dealerIndex] ?? null,
  whoseTurnSeat: state.whoseTurnSeat,
  handSizes: Object.fromEntries(
    state.seatOrder.map((seat, index) => [seat, state.hand.hands[index]?.length ?? 0]),
  ),
  kittyCount: state.hand.kitty.length,
  kittySize: state.hand.kittySize,
  trickCards: state.hand.trickCards,
  handPoints: state.hand.handPoints,
  biddersSet: state.hand.biddersSet,
  gameScores: state.scores,
});

const emitHandState = (roomCode: string, state: GameState) => {
  io.to(roomCode).emit('hand:state', toHandPublicState(state));
};

const emitGameState = (roomCode: string, state: GameState) => {
  io.to(roomCode).emit('game:state', toGamePublicState(state));
};

const emitPrivateHands = async (roomCode: string, state: GameState) => {
  const sockets = await io.in(roomCode).fetchSockets();
  for (const roomSocket of sockets) {
    const playerId = roomSocket.data.playerId;
    if (!playerId) continue;
    const playerIndex = state.playerOrder.indexOf(playerId);
    if (playerIndex === -1) continue;
    const payload: { hand: Card[]; kitty?: Card[] } = {
      hand: state.hand.hands[playerIndex] ?? [],
    };
    if (
      state.hand.kittyPickedUp &&
      state.hand.bidder === playerIndex &&
      state.phase === 'kitty'
    ) {
      payload.kitty = state.hand.kittyPickedUpCards;
    }
    roomSocket.emit('hand:private', payload);
  }
};

io.on('connection', (socket) => {
  socket.emit('server:hello', { ok: true, serverTime: Date.now() });

  socket.on('client:ping', () => {
    socket.emit('server:pong', { serverTime: Date.now() });
  });

  socket.on(
    'room:create',
    ({ roomCode, playerId }: RoomCreatePayload, ack?: (payload: RoomAck) => void) => {
      const resolvedPlayerId = playerId ?? socket.id;
      socket.data.playerId = resolvedPlayerId;
      const requestedCode = roomCode?.trim().toUpperCase();

      let result = requestedCode
        ? rooms.createRoom(requestedCode, resolvedPlayerId)
        : { ok: false as const, error: 'room exists' };

      if (!requestedCode) {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const code = generateRoomCode();
          result = rooms.createRoom(code, resolvedPlayerId);
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

  socket.on('room:join', ({ roomCode }: RoomJoinPayload, ack?: (payload: RoomAck) => void) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const result = rooms.joinRoom(roomCode.trim().toUpperCase(), resolvedPlayerId);
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
  });

  socket.on('room:sit', ({ roomCode, seat }: RoomSitPayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const result = rooms.sit(roomCode, resolvedPlayerId, seat);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }

    io.to(roomCode).emit('room:state', result.value);
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

    const result = games.startGame(roomState, settings);
    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }

    emitGameState(normalizedCode, result.value);
    emitHandState(normalizedCode, result.value);
    await emitPrivateHands(normalizedCode, result.value);
  });

  socket.on('game:bid', ({ roomCode, amount }: GameBidPayload) => {
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
  });

  socket.on('game:pass', ({ roomCode }: GamePassPayload) => {
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
  });

  socket.on('game:passPartner', ({ roomCode }: GamePassPartnerPayload) => {
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
});

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT}`);
});
