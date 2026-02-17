import { describe, expect, it } from 'vitest';
import { RoomStore } from './rooms.js';

describe('RoomStore', () => {
  it('prevents sitting in a taken seat', () => {
    const store = new RoomStore();

    const created = store.createRoom('ROOM1', 'player-a');
    expect(created.ok).toBe(true);

    const joined = store.joinRoom('ROOM1', 'player-b');
    expect(joined.ok).toBe(true);

    const sitA = store.sit('ROOM1', 'player-a', 'T1P1');
    expect(sitA.ok).toBe(true);

    const sitB = store.sit('ROOM1', 'player-b', 'T1P1');
    expect(sitB.ok).toBe(false);
    if (!sitB.ok) {
      expect(sitB.error).toBe('seat taken');
    }
  });

  it('moves a player between seats and tracks ready state', () => {
    const store = new RoomStore();

    const created = store.createRoom('ROOM2', 'player-a');
    expect(created.ok).toBe(true);

    const sitFirst = store.sit('ROOM2', 'player-a', 'T1P1');
    expect(sitFirst.ok).toBe(true);
    expect(sitFirst.ok && sitFirst.value.ready['player-a']).toBe(true);

    const sitSecond = store.sit('ROOM2', 'player-a', 'T2P2');
    expect(sitSecond.ok).toBe(true);

    const state = store.getRoomState('ROOM2');
    expect(state?.seats.T1P1).toBe(null);
    expect(state?.seats.T2P2).toBe('player-a');
    expect(state?.ready['player-a']).toBe(true);
  });

  it('stores player names and removes them when players leave', () => {
    const store = new RoomStore();

    const created = store.createRoom('ROOM3', 'player-a', 'Alice');
    expect(created.ok).toBe(true);

    const joined = store.joinRoom('ROOM3', 'player-b', 'Bob');
    expect(joined.ok).toBe(true);

    const state = store.getRoomState('ROOM3');
    expect(state?.playerNames['player-a']).toBe('Alice');
    expect(state?.playerNames['player-b']).toBe('Bob');

    const removed = store.removePlayer('ROOM3', 'player-b');
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.playerNames['player-b']).toBeUndefined();
  });

  it('lets a connected player leave their seat and clears ready', () => {
    const store = new RoomStore();
    const created = store.createRoom('ROOM4', 'player-a', 'Alice');
    expect(created.ok).toBe(true);

    const sat = store.sit('ROOM4', 'player-a', 'T1P1');
    expect(sat.ok).toBe(true);
    expect(sat.ok && sat.value.ready['player-a']).toBe(true);

    const left = store.leaveSeat('ROOM4', 'player-a');
    expect(left.ok).toBe(true);
    if (!left.ok) return;

    expect(left.value.seats.T1P1).toBe(null);
    expect(left.value.ready['player-a']).toBe(false);
  });
});
