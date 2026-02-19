export type PlayerId = 0 | 1 | 2 | 3;
export type TeamId = 0 | 1;

export type BidAction = { type: 'bid'; player: PlayerId; amount: number };
export type PassAction = { type: 'pass'; player: PlayerId };
export type PassPartnerAction = { type: 'passPartner'; player: PlayerId };
export type BiddingAction = BidAction | PassAction | PassPartnerAction;

export type Bid = { player: PlayerId; amount: number };

export type BiddingState = {
  currentPlayer: PlayerId;
  minBid: number;
  step: number;
  highBid: Bid | null;
  passed: [boolean, boolean, boolean, boolean];
  passPartnerUsed: [boolean, boolean];
  history: BiddingAction[];
};

export const DEFAULT_MIN_BID = 100;
export const DEFAULT_MAX_BID = 200;
export const DEFAULT_BID_STEP = 5;

const PLAYERS: PlayerId[] = [0, 1, 2, 3];

export function teamOf(player: PlayerId): TeamId {
  return (player % 2) as TeamId;
}

export function partnerOf(player: PlayerId): PlayerId {
  return ((player + 2) % 4) as PlayerId;
}

export function createBiddingState(
  startingPlayer: PlayerId = 0,
  minBid: number = DEFAULT_MIN_BID,
  step: number = DEFAULT_BID_STEP,
): BiddingState {
  return {
    currentPlayer: startingPlayer,
    minBid,
    step,
    highBid: null,
    passed: [false, false, false, false],
    passPartnerUsed: [false, false],
    history: [],
  };
}

export function isBiddingComplete(state: BiddingState): boolean {
  return countPassed(state.passed) >= 3;
}

export function getWinningBid(state: BiddingState): Bid | null {
  if (!isBiddingComplete(state)) return null;
  return state.highBid;
}

export function applyBiddingAction(state: BiddingState, action: BiddingAction): BiddingState {
  if (isBiddingComplete(state)) {
    throw new Error('Bidding is complete. No further actions allowed.');
  }
  if (action.player !== state.currentPlayer) {
    throw new Error('Action must be taken by the current player.');
  }
  if (state.passed[action.player]) {
    throw new Error('Passed players cannot act.');
  }

  switch (action.type) {
    case 'bid':
      return applyBid(state, action);
    case 'pass':
      return applyPass(state, action);
    case 'passPartner':
      return applyPassPartner(state, action);
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function applyBid(state: BiddingState, action: BidAction): BiddingState {
  const { amount } = action;
  if (amount < state.minBid) {
    throw new Error(`Bid must be at least ${state.minBid}.`);
  }
  if (amount > DEFAULT_MAX_BID) {
    throw new Error(`Bid cannot exceed ${DEFAULT_MAX_BID}.`);
  }
  if (amount % state.step !== 0) {
    throw new Error(`Bid must be in increments of ${state.step}.`);
  }
  if (state.highBid && amount <= state.highBid.amount) {
    throw new Error('Bid must exceed the current high bid.');
  }

  const nextPlayer = nextActivePlayer(state.passed, action.player);
  return {
    ...state,
    highBid: { player: action.player, amount },
    currentPlayer: nextPlayer,
    history: [...state.history, action],
  };
}

function applyPass(state: BiddingState, action: PassAction): BiddingState {
  const passed = [...state.passed] as BiddingState['passed'];
  passed[action.player] = true;

  const nextPlayer = nextActivePlayer(passed, action.player);
  return {
    ...state,
    passed,
    currentPlayer: nextPlayer,
    history: [...state.history, action],
  };
}

function applyPassPartner(state: BiddingState, action: PassPartnerAction): BiddingState {
  if (!state.highBid) {
    throw new Error('Cannot pass partner before any bid is made.');
  }
  const partner = partnerOf(action.player);
  if (state.highBid.player !== partner) {
    throw new Error('PassPartner is only allowed when your partner is the high bidder.');
  }
  const team = teamOf(action.player);
  if (state.passPartnerUsed[team]) {
    throw new Error('PassPartner has already been used by this team.');
  }

  const passPartnerUsed = [...state.passPartnerUsed] as BiddingState['passPartnerUsed'];
  passPartnerUsed[team] = true;
  const nextPlayer = nextActivePlayer(state.passed, action.player);

  return {
    ...state,
    passPartnerUsed,
    currentPlayer: nextPlayer,
    history: [...state.history, action],
  };
}

function nextActivePlayer(passed: BiddingState['passed'], from: PlayerId): PlayerId {
  for (let i = 1; i <= PLAYERS.length; i += 1) {
    const candidate = ((from + i) % 4) as PlayerId;
    if (!passed[candidate]) return candidate;
  }
  return from;
}

function countPassed(passed: BiddingState['passed']): number {
  let count = 0;
  for (const player of PLAYERS) {
    if (passed[player]) count += 1;
  }
  return count;
}
