# Recut — AI Showrunner

An AI agent that writes and directs a short drama. Every other tool gives you shots;
Recut gives you a series — a Series Bible, a continuity critic, and camera rigs that
compile cinematography from nothing.

Build plan: `CLAUDE.md`. Sprint log: `docs/SPRINT_LOG.md`. Migration audit: `docs/MIGRATION.md`.

## Run
- `pnpm install`
- `pnpm dev` — app at http://localhost:3000
- Gates: `pnpm typecheck && pnpm test && pnpm build`, `pnpm test:e2e`, `pnpm budget`

Everything runs in **replay mode** (zero network) by default. Live spend is capped by
`RECUT_BUDGET_USD` and gated by the budget governor.
