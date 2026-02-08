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

    const sitSecond = store.sit('ROOM2', 'player-a', 'T2P2');
    expect(sitSecond.ok).toBe(true);

    const ready = store.setReady('ROOM2', 'player-a', true);
    expect(ready.ok).toBe(true);

    const state = store.getRoomState('ROOM2');
    expect(state?.seats.T1P1).toBe(null);
    expect(state?.seats.T2P2).toBe('player-a');
    expect(state?.ready['player-a']).toBe(true);
  });
});
