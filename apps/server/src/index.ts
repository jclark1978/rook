import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { RoomStore } from './rooms.js';

const PORT = Number(process.env.PORT ?? 3001);
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

const app = express();
app.use(cors({ origin: ORIGIN, credentials: true }));
app.get('/health', (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ORIGIN, credentials: true },
});

type RoomCreatePayload = { roomCode: string; playerId?: string };
type RoomJoinPayload = { roomCode: string };
type RoomSitPayload = { roomCode: string; seat: string };
type RoomReadyPayload = { roomCode: string; ready: boolean };

const rooms = new RoomStore();

io.on('connection', (socket) => {
  socket.emit('server:hello', { ok: true, serverTime: Date.now() });

  socket.on('client:ping', () => {
    socket.emit('server:pong', { serverTime: Date.now() });
  });

  socket.on('room:create', ({ roomCode, playerId }: RoomCreatePayload) => {
    const resolvedPlayerId = playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const result = rooms.createRoom(roomCode, resolvedPlayerId);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }

    socket.join(roomCode);
    io.to(roomCode).emit('room:state', result.value);
  });

  socket.on('room:join', ({ roomCode }: RoomJoinPayload) => {
    const resolvedPlayerId = socket.data.playerId ?? socket.id;
    socket.data.playerId = resolvedPlayerId;
    const result = rooms.joinRoom(roomCode, resolvedPlayerId);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }

    socket.join(roomCode);
    io.to(roomCode).emit('room:state', result.value);
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
