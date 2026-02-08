# Multi-agent workflow (local-first)

This repo is designed to let multiple agents (and humans) work in parallel without stepping on each other.

## Principles
- **One task = one branch** (no shared branches for active work)
- **Small PR-sized commits** (even if we’re not using GitHub yet)
- **Fast tests** required before merge: `npm test` (or at least package-level tests)
- **Write down decisions** in `docs/DECISIONS.md` (short entries)

## Branching
- `main`: stable, always runnable
- `dev`: integration
- `feat/<short-name>`: feature work
- `fix/<short-name>`: fixes

Merge policy (local):
- work lands in `dev` first
- periodically merge `dev` -> `main`

## Task board
- Source of truth: `docs/TASKBOARD.md`
- Every task has: owner, branch name, done definition, and check-in note.

## Check-in protocol (for agents)
When starting:
1) `git checkout dev && git pull` (local pull only if remotes exist)
2) Create branch: `git checkout -b feat/<task>`
3) Add yourself to the task’s **Owner** field in `docs/TASKBOARD.md`

While working:
- Keep changes focused
- Run relevant tests

When done:
1) Update `docs/TASKBOARD.md` with:
   - status: Done
   - what changed
   - how to test
2) Commit on your branch
3) Ask lead (Skippy) to merge into `dev`

## Repo commands
- Install: `npm install`
- Test all: `npm test`
- Dev web: `npm run -w @rook/web dev -- --host 0.0.0.0 --port 5173`
- Dev server: `npm run -w @rook/server dev`
