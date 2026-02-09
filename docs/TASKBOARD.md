# Task Board

Format: keep tasks small enough to finish in ~20–60 minutes.

## Now (parallelizable)

### T1 — Web app shell + routing + lobby stub UI
- **Owner:** unassigned
- **Branch:** `feat/web-lobby-shell`
- **Goal:** Replace Vite demo with Rook UI shell.
- **Done when:**
  - Home page shows Create/Join room
  - Basic lobby page shows 4 seats + ready toggles (UI only is ok if server hooks not ready)
  - Mobile responsive layout
- **How to test:** open `:5173` and click through

### T2 — Server room model + socket events (no game logic yet)
- **Owner:** unassigned
- **Branch:** `feat/server-rooms`
- **Goal:** Create/join room + seat assignment + ready state via Socket.IO.
- **Done when:**
  - events: `room:create`, `room:join`, `room:sit`, `room:ready`, `room:state`
  - server stores rooms in-memory
  - minimal validation (seat taken, 4 max)
- **How to test:** use browser console or simple client to create/join and see state updates

### T3 — Engine: bidding state + Pass-Partner rules + tests
- **Owner:** unassigned
- **Branch:** `feat/engine-bidding`
- **Goal:** Implement bidding phase logic in `@rook/engine`.
- **Done when:**
  - min bid 100, step 5
  - pass = out
  - pass-partner: once per team per round; only when partner is current high bidder; skip only
  - bid ends when 3 players passed
  - tests include Jeff’s example sequence

### T4 — Engine: trick legality + trick winner + tests
- **Owner:** unassigned
- **Branch:** `feat/engine-tricks`
- **Goal:** follow-suit enforcement + trick winner.
- **Done when:**
  - must follow suit if possible
  - otherwise any card allowed
  - trump beats non-trump
  - rook always trump; rook high/low toggle
  - tests for tricky cases

### T5 — Engine: scoring + contract resolution + tests
- **Owner:** unassigned
- **Branch:** `feat/engine-scoring`
- **Goal:** scoring per your spec.
- **Done when:**
  - point cards + last trick bonus
  - kitty assigned to last trick team
  - bidders: if set -> exactly -bid, else points taken
  - defenders always get their points
  - tests verifying totals sum to 200 and contract math

## Next session notes (Jeff)
- (3) Clicking a card in trick phase should play it; verify turn gating + server event, fix if still inert.
- (4) After discard completes, kitty should be hidden from bidder too (memory-only advantage).
- (5) If any point cards are in the kitty after discard, notify all players: “There are points in the kitty” (no details).

## Integration milestones
- **M1 (worth checking site):** Lobby works end-to-end (T1 + T2)
- **M2:** Bidding playable end-to-end (M1 + T3 + minimal UI)
- **M3:** Full hand playable (M2 + T4 + T5 + kitty/trump + UI)
