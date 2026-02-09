import type { Card, Color } from './cards.js';
import { cardId } from './cards.js';
import type { RookRankMode } from './index.js';

export type TrumpColor = Color;

export type TrickState = {
  leadColor?: TrumpColor;
  cardsInOrder: Card[];
};

export function getLegalPlays(
  hand: Card[],
  trickLeadColor: TrumpColor | undefined,
  _trumpColor: TrumpColor,
  _rookRankMode: RookRankMode,
): string[] {
  if (!trickLeadColor) return hand.map(cardId);

  const leadSuitCards = hand.filter(
    (card) => card.kind === 'suit' && card.color === trickLeadColor,
  );

  if (leadSuitCards.length > 0) return leadSuitCards.map(cardId);
  return hand.map(cardId);
}

function rankValue(card: Card): number {
  if (card.kind === 'rook') return 0;
  if (card.rank === 1) return 15;
  return card.rank;
}

type CardScore = {
  major: number;
  tier: number;
  rank: number;
};

function scoreCard(
  card: Card,
  leadColor: TrumpColor | undefined,
  trumpColor: TrumpColor,
  rookRankMode: RookRankMode,
): CardScore {
  if (card.kind === 'rook') {
    return {
      major: 2,
      tier: rookRankMode === 'rookHigh' ? 2 : 0,
      rank: 0,
    };
  }

  if (card.color === trumpColor) {
    return { major: 2, tier: 1, rank: rankValue(card) };
  }

  if (leadColor && card.color === leadColor) {
    return { major: 1, tier: 0, rank: rankValue(card) };
  }

  return { major: 0, tier: 0, rank: 0 };
}

export function determineTrickWinner(
  trickCardsInOrder: Card[],
  leadColor: TrumpColor | undefined,
  trumpColor: TrumpColor,
  rookRankMode: RookRankMode,
): number {
  if (trickCardsInOrder.length === 0) return -1;

  let bestIndex = 0;
  let bestScore = scoreCard(trickCardsInOrder[0], leadColor, trumpColor, rookRankMode);

  for (let i = 1; i < trickCardsInOrder.length; i += 1) {
    const score = scoreCard(trickCardsInOrder[i], leadColor, trumpColor, rookRankMode);

    if (
      score.major > bestScore.major ||
      (score.major === bestScore.major && score.tier > bestScore.tier) ||
      (score.major === bestScore.major &&
        score.tier === bestScore.tier &&
        score.rank > bestScore.rank)
    ) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}
