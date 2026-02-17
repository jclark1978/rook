import { describe, expect, it } from 'vitest';
import { nextSeat, partnerSeat, seatToTeam } from '../src/state.js';

describe('state helpers', () => {
  it('maps seats to teams', () => {
    expect(seatToTeam('T1P1')).toBe('T1');
    expect(seatToTeam('T1P2')).toBe('T1');
    expect(seatToTeam('T2P1')).toBe('T2');
    expect(seatToTeam('T2P2')).toBe('T2');
  });

  it('returns partner seats', () => {
    expect(partnerSeat('T1P1')).toBe('T1P2');
    expect(partnerSeat('T1P2')).toBe('T1P1');
    expect(partnerSeat('T2P1')).toBe('T2P2');
    expect(partnerSeat('T2P2')).toBe('T2P1');
  });

  it('rotates to the next seat in order', () => {
    expect(nextSeat('T1P1')).toBe('T2P1');
    expect(nextSeat('T2P1')).toBe('T1P2');
    expect(nextSeat('T1P2')).toBe('T2P2');
    expect(nextSeat('T2P2')).toBe('T1P1');
  });
});
