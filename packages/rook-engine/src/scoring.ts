import { cardPoints, Card } from './cards.js';
import { TeamId } from './bidding.js';

export type TeamCards = [Card[], Card[]];

export type HandScore = {
  points: [number, number];
  scores: [number, number];
};

function sumPoints(cards: Card[]): number {
  let total = 0;
  for (const card of cards) {
    total += cardPoints(card);
  }
  return total;
}

export function scoreHand(
  capturedByTeam: TeamCards,
  lastTrickTeam: TeamId,
  kittyCards: Card[],
  biddingTeam: TeamId,
  bidAmount: number,
): HandScore {
  const points: [number, number] = [sumPoints(capturedByTeam[0]), sumPoints(capturedByTeam[1])];

  points[lastTrickTeam] += 20;
  points[lastTrickTeam] += sumPoints(kittyCards);

  const scores: [number, number] = [points[0], points[1]];
  if (points[biddingTeam] < bidAmount) {
    scores[biddingTeam] = -bidAmount;
  }

  return { points, scores };
}
