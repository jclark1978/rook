import type { DeckMode, RookRankMode } from './index.js';
import {
  applyBiddingAction,
  createBiddingState,
  getWinningBid,
  isBiddingComplete,
  type BiddingAction,
  type BiddingState,
  type PlayerId,
} from './bidding.js';
import { cardId, type Card, type Color } from './cards.js';

export type HandPhase = 'bidding' | 'kittyPickup' | 'kittyDiscard' | 'declareTrump' | 'trick';

export type HandState = {
  phase: HandPhase;
  settings: {
    deckMode: DeckMode;
    rookRankMode: RookRankMode;
  };
  hands: [Card[], Card[], Card[], Card[]];
  kitty: Card[];
  trumpColor: Color | null;
  bidder: PlayerId | null;
  winningBid: number | null;
  biddingState: BiddingState | null;
};

export type PickupKittyAction = { type: 'pickupKitty'; player: PlayerId };
export type DiscardToKittyAction = { type: 'discardToKitty'; player: PlayerId; cards: Card[] };
export type DeclareTrumpAction = { type: 'declareTrump'; player: PlayerId; color: Color };

export type HandAction =
  | BiddingAction
  | PickupKittyAction
  | DiscardToKittyAction
  | DeclareTrumpAction;

export function createHandStateFromDeal(
  settings: { deckMode: DeckMode; rookRankMode: RookRankMode },
  hands: [Card[], Card[], Card[], Card[]],
  kitty: Card[],
): HandState {
  return {
    phase: 'bidding',
    settings,
    hands,
    kitty,
    trumpColor: null,
    bidder: null,
    winningBid: null,
    biddingState: createBiddingState(),
  };
}

export function applyHandAction(state: HandState, action: HandAction): HandState {
  switch (action.type) {
    case 'bid':
    case 'pass':
    case 'passPartner': {
      if (state.phase !== 'bidding' || !state.biddingState) {
        throw new Error('Bidding actions are only allowed during the bidding phase.');
      }
      const nextBiddingState = applyBiddingAction(state.biddingState, action);
      if (!isBiddingComplete(nextBiddingState)) {
        return { ...state, biddingState: nextBiddingState };
      }

      const winningBid = getWinningBid(nextBiddingState);
      if (!winningBid) {
        throw new Error('Bidding completed without a winning bid.');
      }

      return {
        ...state,
        phase: 'kittyPickup',
        bidder: winningBid.player,
        winningBid: winningBid.amount,
        biddingState: nextBiddingState,
      };
    }
    case 'pickupKitty': {
      assertPhase(state, 'kittyPickup');
      assertBidder(state, action.player);

      const updatedHand = [...state.hands[action.player], ...state.kitty];
      return {
        ...state,
        phase: 'kittyDiscard',
        hands: replaceHand(state.hands, action.player, updatedHand),
        kitty: [],
      };
    }
    case 'discardToKitty': {
      assertPhase(state, 'kittyDiscard');
      assertBidder(state, action.player);
      if (action.cards.length !== 5) {
        throw new Error('Must discard exactly 5 cards to the kitty.');
      }

      const updatedHand = removeCardsFromHand(state.hands[action.player], action.cards);

      return {
        ...state,
        phase: 'declareTrump',
        hands: replaceHand(state.hands, action.player, updatedHand),
        kitty: [...action.cards],
      };
    }
    case 'declareTrump': {
      assertPhase(state, 'declareTrump');
      assertBidder(state, action.player);
      return {
        ...state,
        phase: 'trick',
        trumpColor: action.color,
      };
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function assertPhase(state: HandState, expected: HandPhase): void {
  if (state.phase !== expected) {
    throw new Error(`Action not allowed during ${state.phase} phase.`);
  }
}

function assertBidder(state: HandState, player: PlayerId): void {
  if (state.bidder === null) {
    throw new Error('No bidder has been set yet.');
  }
  if (state.bidder !== player) {
    throw new Error('Only the bidder may perform this action.');
  }
}

function replaceHand(
  hands: [Card[], Card[], Card[], Card[]],
  player: PlayerId,
  nextHand: Card[],
): [Card[], Card[], Card[], Card[]] {
  return hands.map((hand, index) => (index === player ? nextHand : hand)) as [
    Card[],
    Card[],
    Card[],
    Card[],
  ];
}

function removeCardsFromHand(hand: Card[], cards: Card[]): Card[] {
  const required = new Map<string, number>();
  for (const card of cards) {
    const id = cardId(card);
    required.set(id, (required.get(id) ?? 0) + 1);
  }

  const updated: Card[] = [];
  for (const card of hand) {
    const id = cardId(card);
    const remaining = required.get(id) ?? 0;
    if (remaining > 0) {
      required.set(id, remaining - 1);
    } else {
      updated.push(card);
    }
  }

  for (const [id, remaining] of required) {
    if (remaining > 0) {
      throw new Error(`Cannot discard card not in hand: ${id}.`);
    }
  }

  return updated;
}
