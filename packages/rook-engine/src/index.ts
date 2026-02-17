export type DeckMode = 'full' | 'fast';
export type RookRankMode = 'rookHigh' | 'rookLow';

export type GameSettings = {
  targetScore: number;
  deckMode: DeckMode;
  rookRankMode: RookRankMode;
};

export const DEFAULT_SETTINGS: GameSettings = {
  targetScore: 700,
  deckMode: 'full',
  rookRankMode: 'rookHigh',
};

export * from './cards.js';
export * from './deck.js';
export {
  applyBiddingAction,
  createBiddingState,
  DEFAULT_BID_STEP,
  DEFAULT_MIN_BID,
  getWinningBid,
  isBiddingComplete,
  partnerOf,
  teamOf,
} from './bidding.js';
export type {
  Bid,
  BidAction,
  BiddingAction,
  BiddingState,
  PassAction,
  PassPartnerAction,
  PlayerId,
} from './bidding.js';
export * from './trick.js';
export * from './trickRound.js';
export * from './scoring.js';
export * from './state.js';
export * from './hand.js';
