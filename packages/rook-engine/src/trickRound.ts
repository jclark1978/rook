import type { Card, Color } from './cards.js';
import type { RookRankMode } from './index.js';
import type { SeatId } from './state.js';
import { determineTrickWinner } from './trick.js';

export type TrickRound = {
  leadColor?: Color;
  cards: Card[];
  seats: SeatId[];
  trumpColor: Color;
  rookRankMode: RookRankMode;
};

type SeatOrPlayer = SeatId | number;

function resolveSeatIndex(trickState: TrickRound, seatOrPlayer: SeatOrPlayer): number {
  if (typeof seatOrPlayer === 'number') return seatOrPlayer;
  return trickState.seats.indexOf(seatOrPlayer);
}

export function applyPlay(
  trickState: TrickRound,
  seatOrPlayer: SeatOrPlayer,
  card: Card,
): TrickRound {
  const seatIndex = resolveSeatIndex(trickState, seatOrPlayer);
  if (seatIndex < 0) {
    throw new Error('Seat not found in trick order.');
  }
  if (seatIndex !== trickState.cards.length) {
    throw new Error('Play is out of turn for this trick.');
  }

  const nextLeadColor =
    trickState.leadColor ?? (card.kind === 'suit' ? card.color : undefined);

  return {
    ...trickState,
    leadColor: nextLeadColor,
    cards: [...trickState.cards, card],
  };
}

export function isTrickComplete(trickState: TrickRound): boolean {
  return trickState.cards.length === trickState.seats.length;
}

export function trickWinner(trickState: TrickRound): SeatId | undefined {
  const winnerIndex = determineTrickWinner(
    trickState.cards,
    trickState.leadColor,
    trickState.trumpColor,
    trickState.rookRankMode,
  );

  if (winnerIndex < 0) return undefined;
  return trickState.seats[winnerIndex];
}
