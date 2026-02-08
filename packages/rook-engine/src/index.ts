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
