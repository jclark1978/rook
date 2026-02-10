# The Rook Room

Private, browser-based multiplayer **Rook** for friends and family.

This monorepo contains a realtime server, a deterministic rules engine, and a React client.

## Current capabilities
- Create or join private rooms with a 4-character game ID
- Player handle capture and persistence (`localStorage`)
- Team seating with live player names
- Room creator sets **Game Winning Score** (fixed for that room)
- Pre-deal flow: dealer chooses `Rook High` or `Rook Low`, then deals
- Bidding with `Bid`, `Pass`, and `Pass Partner`
- All-pass fallback: dealer is auto-awarded bid at `100`
- Kitty pickup/discard and trump declaration
- Trick play with follow-suit validation
- Hand scoring and running game score
- Game ends when a team reaches target score

## Tech stack
- Web: React + Vite + TypeScript + Socket.IO client
- Server: Node.js + Express + Socket.IO + TypeScript
- Engine: TypeScript rules/deck/scoring utilities

## Repository layout
- `apps/web` - client UI
- `apps/server` - realtime API/socket server
- `packages/rook-engine` - shared game engine logic
- `docs/` - rules notes/spec

## Local development
From repo root:

```bash
npm install

# option 1: run both from root
npm run dev

# option 2: run separately
npm run -w @rook/server dev
npm run -w @rook/web dev -- --host 0.0.0.0 --port 5173
```

Open:
- Web: `http://localhost:5173`
- Server health: `http://localhost:3001/health`

The web client connects to `http(s)://<current-host>:3001`.

## Build, test, lint
From repo root:

```bash
npm run build
npm run test
npm run lint
npm run typecheck
```

## Server environment
- `PORT` (default: `3001`)
- `CORS_ORIGIN` (optional; defaults include local dev hosts)

## Game flow (current)
1. Create/join room and take seats
2. Dealer chooses rook mode and clicks Deal
3. Bidding
4. Bid winner picks up kitty, discards 5
5. Bid winner declares trump
6. Trick play
7. Hand summary and score update
8. Next hand (dealer rotates) until a team reaches target score

## Notes
This project is under active iteration. UI and game rules enforcement may continue to evolve.
