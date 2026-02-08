export type Color = 'red' | 'yellow' | 'green' | 'black';

export type Card =
  | { kind: 'suit'; color: Color; rank: number } // rank is 1..14 (some removed by deck mode)
  | { kind: 'rook' };

export function cardId(card: Card): string {
  if (card.kind === 'rook') return 'ROOK';
  return `${card.color.toUpperCase()}_${card.rank}`;
}

export function isPointCard(card: Card): boolean {
  if (card.kind === 'rook') return true;
  return card.rank === 1 || card.rank === 5 || card.rank === 10 || card.rank === 14;
}

export function cardPoints(card: Card): number {
  if (card.kind === 'rook') return 20;
  switch (card.rank) {
    case 1:
      return 15;
    case 5:
      return 5;
    case 10:
      return 10;
    case 14:
      return 10;
    default:
      return 0;
  }
}
