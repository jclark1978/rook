export type DeckMode = 'full' | 'fast';
export type RookRankMode = 'rookHigh' | 'rookLow';

export type GameSettings = {
  targetScore: number;
  deckMode: DeckMode;
  rookRankMode: RookRankMode;
};

// Placeholder exports. Next step is implementing the full rules engine.
export const DEFAULT_SETTINGS: GameSettings = {
  targetScore: 700,
  deckMode: 'full',
  rookRankMode: 'rookHigh',
};
