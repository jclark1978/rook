export type Seat = 'T1P1' | 'T2P1' | 'T1P2' | 'T2P2';

export const SEATS: Seat[] = ['T1P1', 'T2P1', 'T1P2', 'T2P2'];

export type RoomState = {
  roomCode: string;
  seats: Record<Seat, string | null>;
  players: string[];
  ready: Record<string, boolean>;
  playerNames: Record<string, string>;
  ownerId: string;
  targetScore: number;
};

type Room = {
  roomCode: string;
  seats: Record<Seat, string | null>;
  players: Set<string>;
  ready: Map<string, boolean>;
  playerNames: Map<string, string>;
  ownerId: string;
  targetScore: number;
};

const createEmptySeats = (): Record<Seat, string | null> => ({
  T1P1: null,
  T2P1: null,
  T1P2: null,
  T2P2: null,
});

const isSeat = (seat: string): seat is Seat => SEATS.includes(seat as Seat);

export type RoomResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export class RoomStore {
  private rooms = new Map<string, Room>();

  removePlayer(roomCode: string, playerId: string): RoomResult<RoomState> {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return { ok: false, error: 'room missing' };
    }

    room.players.delete(playerId);
    room.ready.delete(playerId);
    room.playerNames.delete(playerId);

    for (const seatKey of SEATS) {
      if (room.seats[seatKey] === playerId) {
        room.seats[seatKey] = null;
      }
    }

    return { ok: true, value: this.toState(room) };
  }

  createRoom(
    roomCode: string,
    playerId: string,
    playerName?: string,
    targetScore?: number,
  ): RoomResult<RoomState> {
    if (this.rooms.has(roomCode)) {
      return { ok: false, error: 'room exists' };
    }

    const normalizedTarget = this.normalizeTargetScore(targetScore);
    const room: Room = {
      roomCode,
      seats: createEmptySeats(),
      players: new Set([playerId]),
      ready: new Map([[playerId, false]]),
      playerNames: new Map([[playerId, this.normalizePlayerName(playerName)]]),
      ownerId: playerId,
      targetScore: normalizedTarget,
    };

    this.rooms.set(roomCode, room);
    return { ok: true, value: this.toState(room) };
  }

  joinRoom(roomCode: string, playerId: string, playerName?: string): RoomResult<RoomState> {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return { ok: false, error: 'room missing' };
    }

    room.players.add(playerId);
    if (!room.ready.has(playerId)) {
      room.ready.set(playerId, false);
    }
    room.playerNames.set(playerId, this.normalizePlayerName(playerName));

    return { ok: true, value: this.toState(room) };
  }

  sit(roomCode: string, playerId: string, seat: string): RoomResult<RoomState> {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return { ok: false, error: 'room missing' };
    }

    if (!isSeat(seat)) {
      return { ok: false, error: 'invalid seat' };
    }

    const currentOwner = room.seats[seat];
    if (currentOwner && currentOwner !== playerId) {
      return { ok: false, error: 'seat taken' };
    }

    for (const seatKey of SEATS) {
      if (room.seats[seatKey] === playerId) {
        room.seats[seatKey] = null;
      }
    }

    room.seats[seat] = playerId;
    // Seat selection implies readiness in the current lobby flow.
    room.ready.set(playerId, true);

    return { ok: true, value: this.toState(room) };
  }

  leaveSeat(roomCode: string, playerId: string): RoomResult<RoomState> {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return { ok: false, error: 'room missing' };
    }

    for (const seatKey of SEATS) {
      if (room.seats[seatKey] === playerId) {
        room.seats[seatKey] = null;
      }
    }
    room.ready.set(playerId, false);

    return { ok: true, value: this.toState(room) };
  }

  setReady(roomCode: string, playerId: string, ready: boolean): RoomResult<RoomState> {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return { ok: false, error: 'room missing' };
    }

    if (!room.players.has(playerId)) {
      room.players.add(playerId);
    }

    room.ready.set(playerId, ready);

    return { ok: true, value: this.toState(room) };
  }

  getRoomState(roomCode: string): RoomState | null {
    const room = this.rooms.get(roomCode);
    return room ? this.toState(room) : null;
  }

  private toState(room: Room): RoomState {
    return {
      roomCode: room.roomCode,
      seats: { ...room.seats },
      players: Array.from(room.players),
      ready: Object.fromEntries(room.ready.entries()),
      playerNames: Object.fromEntries(room.playerNames.entries()),
      ownerId: room.ownerId,
      targetScore: room.targetScore,
    };
  }

  private normalizePlayerName(playerName?: string): string {
    const normalized = playerName?.trim();
    if (!normalized) return 'Guest';
    return normalized.slice(0, 24);
  }

  private normalizeTargetScore(targetScore?: number): number {
    if (!Number.isFinite(targetScore)) return 700;
    const rounded = Math.round(targetScore as number);
    if (rounded < 100) return 100;
    if (rounded > 2000) return 2000;
    return rounded;
  }
}
