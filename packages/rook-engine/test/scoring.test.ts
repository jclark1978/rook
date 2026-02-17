import { describe, expect, it } from 'vitest';
import { Card } from '../src/cards.js';
import { scoreHand } from '../src/scoring.js';
import { TeamId } from '../src/bidding.js';

const COLORS = ['red', 'yellow', 'green', 'black'] as const;

type Color = (typeof COLORS)[number];

function suit(color: Color, rank: number): Card {
  return { kind: 'suit', color, rank };
}

function rook(): Card {
  return { kind: 'rook' };
}

describe('scoring', () => {
  it('total available points per hand sums to 200', () => {
    const scoringCards: Card[] = [];
    for (const color of COLORS) {
      scoringCards.push(suit(color, 1), suit(color, 5), suit(color, 10), suit(color, 14));
    }
    scoringCards.push(rook());

    const capturedByTeam: [Card[], Card[]] = [scoringCards, []];
    const lastTrickTeam: TeamId = 0;

    const { points } = scoreHand(capturedByTeam, lastTrickTeam, [], 0, 100);
    expect(points[0] + points[1]).toBe(200);
  });

  it('contract set returns -bid for bidding team', () => {
    const team0Cards: Card[] = [
      rook(),
      suit('red', 10),
      suit('yellow', 10),
      suit('green', 14),
      suit('black', 14),
      suit('red', 5),
      suit('yellow', 5),
      suit('green', 5),
      suit('black', 1),
    ];
    const team1Cards: Card[] = [
      suit('red', 1),
      suit('yellow', 1),
      suit('green', 10),
      suit('black', 10),
      suit('red', 14),
      suit('yellow', 14),
      suit('green', 5),
      suit('black', 5),
    ];

    const { points, scores } = scoreHand([team0Cards, team1Cards], 1, [], 0, 120);

    expect(points[0]).toBe(90);
    expect(points[1]).toBe(100);
    expect(scores[0]).toBe(-120);
    expect(scores[1]).toBe(points[1]);
  });

  it('made bid scores actual points', () => {
    const team0Cards: Card[] = [
      rook(),
      suit('red', 10),
      suit('yellow', 10),
      suit('green', 10),
      suit('black', 10),
      suit('red', 14),
      suit('yellow', 14),
      suit('green', 5),
      suit('black', 5),
      suit('red', 5),
      suit('yellow', 1),
    ];
    const team1Cards: Card[] = [suit('green', 1), suit('black', 14), suit('red', 5)];

    const { points, scores } = scoreHand([team0Cards, team1Cards], 0, [], 0, 120);

    expect(points[0]).toBe(130);
    expect(scores[0]).toBe(points[0]);
    expect(scores[1]).toBe(points[1]);
  });
});
