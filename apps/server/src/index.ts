import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { RoomStore, type RoomState } from './rooms.js';

const PORT = Number(process.env.PORT ?? 3001);
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

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
});

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT}`);
});
