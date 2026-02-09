import type { BiddingAction } from './bidding.js';
import type { Card } from './cards.js';
import type { TrumpColor } from './trick.js';

export type SeatId = 'T1P1' | 'T2P1' | 'T1P2' | 'T2P2';
export type TeamId = 'T1' | 'T2';

export type GamePhase = 'lobby' | 'bidding' | 'kitty' | 'declareTrump' | 'trick' | 'score';

export type PlayCardAction = { type: 'playCard'; seat: SeatId; card: Card };
export type DiscardKittyAction = { type: 'discardKitty'; seat: SeatId; cards: Card[] };
export type DeclareTrumpAction = { type: 'declareTrump'; seat: SeatId; trump: TrumpColor };
export type Action =
  | BiddingAction
  | PlayCardAction
  | DiscardKittyAction
  | DeclareTrumpAction;

const SEAT_ORDER: SeatId[] = ['T1P1', 'T2P1', 'T1P2', 'T2P2'];
const PARTNER_SEAT: Record<SeatId, SeatId> = {
  T1P1: 'T1P2',
  T1P2: 'T1P1',
  T2P1: 'T2P2',
  T2P2: 'T2P1',
};

export function seatToTeam(seat: SeatId): TeamId {
  return seat.startsWith('T1') ? 'T1' : 'T2';
}

export function partnerSeat(seat: SeatId): SeatId {
  return PARTNER_SEAT[seat];
}

export function nextSeat(seat: SeatId): SeatId {
  const index = SEAT_ORDER.indexOf(seat);
  return SEAT_ORDER[(index + 1) % SEAT_ORDER.length];
}
