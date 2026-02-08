export type Seat = 'T1P1' | 'T2P1' | 'T1P2' | 'T2P2';

export const SEATS: Seat[] = ['T1P1', 'T2P1', 'T1P2', 'T2P2'];

export type RoomState = {
  roomCode: string;
  seats: Record<Seat, string | null>;
  players: string[];
  ready: Record<string, boolean>;
};

type Room = {
  roomCode: string;
  seats: Record<Seat, string | null>;
  players: Set<string>;
  ready: Map<string, boolean>;
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

  createRoom(roomCode: string, playerId: string): RoomResult<RoomState> {
    if (this.rooms.has(roomCode)) {
      return { ok: false, error: 'room exists' };
    }

    const room: Room = {
      roomCode,
      seats: createEmptySeats(),
      players: new Set([playerId]),
      ready: new Map([[playerId, false]]),
    };

    this.rooms.set(roomCode, room);
    return { ok: true, value: this.toState(room) };
  }

  joinRoom(roomCode: string, playerId: string): RoomResult<RoomState> {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return { ok: false, error: 'room missing' };
    }

    room.players.add(playerId);
    if (!room.ready.has(playerId)) {
      room.ready.set(playerId, false);
    }

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
    };
  }
}
