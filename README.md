# Rook (Online)

A private, browser-based multiplayer implementation of the classic card game **Rook**, with support for Jeff’s house rules.

This repo is a work-in-progress. Current focus is building a deterministic rules engine + real-time room/game server + responsive web UI.

## What’s working (so far)
- Private rooms (create/join by code)
- Seat selection (T1P1, T2P1, T1P2, T2P2) + ready toggles
- Bidding phase (min 100, step 5) with Pass + Pass-Partner
- Kitty flow (pickup + discard 5) and trump declaration
- Trick play (follow-suit enforcement + trick winner)
- Basic scoring utilities (engine)

## Tech stack
- **Web:** React + Vite + TypeScript
- **Server:** Node.js + Express + Socket.IO + TypeScript
- **Rules engine:** TypeScript (deterministic, unit-tested)

## Repo layout
- `apps/web` — web client UI
- `apps/server` — realtime room/game server
- `packages/rook-engine` — rules engine + tests
- `docs/` — rules spec and working notes

## Local development
From the repo root:

```bash
npm install

# run both (separate terminals)
npm run -w @rook/server dev
npm run -w @rook/web dev -- --host 0.0.0.0 --port 5173
```

Then open:
- Web: http://localhost:5173
- Server health: http://localhost:3001/health

## Rules preset
See: `docs/RULES.md`

## Notes
This project is currently built for internal iteration; expect breaking changes.
