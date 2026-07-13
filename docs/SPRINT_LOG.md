# Sprint log

## 2026-07-13 — Sprint 0 (harness) — in progress

**Decision:** greenfield repo `~/recut-v3` on the plan's exact stack (Next 15 / pnpm /
TS strict / Tailwind). recut-v2 audited as the migration subject, not the build target
(see docs/MIGRATION.md — verdict: rewrite, cheaper by hours).

**Shipped (free, zero network):**
- Repo scaffold, pnpm, TS strict (`noUncheckedIndexedAccess`, `noImplicitOverride`).
- `lib/gateway/` harness: content-addressed cache (`hash.ts` = sha256(modelId+payload+seed),
  canonical/key-order-independent), `budget.ts` governor (persisted ledger, fails closed with
  no cap, refuses submit past cap), `jobs.ts` Gateway (replay resolves fixtures with zero
  network; miss throws `GatewayCacheMiss` + logs to `fixtures/MISSING.md`; live gates on the
  governor, records spend, captures fixtures).
- Named exceptions: `GatewayCacheMiss`, `BudgetExceeded`, `BudgetUnset`.
- Eval scripts exist and run: `pnpm budget`, `pnpm eval:ui`, `pnpm eval:continuity`
  (STAGED where screens/fixtures don't exist yet), Playwright wired for `pnpm test:e2e`.
- Harness tests: replay zero-network (asserts `live` never called on a hit), governor refuses
  past cap (asserts `live` never called), hash determinism, fail-closed with no cap.

**Gates verified green (2026-07-13):** `pnpm typecheck` clean · `pnpm test` 7/7
(replay zero-network asserts `live` never called on a hit; governor refuses past cap asserts
`live` never called; hash determinism; fail-closed with no cap) · `pnpm build` OK (Next 15,
static) · `pnpm test:e2e` 1/1 (landing renders) · `pnpm budget` / `eval:ui` / `eval:continuity`
all run (evals STAGED until screens/fixtures exist).

**Environment note:** `pnpm install` was initially blocked — the global `~/.npmrc` routed to the
corporate Synapxe Artifactory (401/403 on `next`, `picomatch`, …). User switched the registry to
public npm; installs then succeeded. Pinned exact versions (Next 15.5.4, React 19.1.1, TS 5.9.3,
Vitest 3.2.4, Tailwind 4.1.16, Playwright 1.56.1).

**Money step (0.1 spike, 0.4 fixtures): HELD at STOP GATE 1.**
- Spike is written + guarded (RECUT_MODE=live + `--confirm` + cheap model-id preflight).
- Reason for holding the costly loop: the plan's model ids (`qwen-image-2.0-pro`,
  `wan2.7-image-pro`) are flagged "confirm in console." Firing the full 6-state × 3-ref loop
  blind risks the budget on unverified ids. Preflight confirms ids first; the costly loop runs
  only after sign-off.

**Spend so far: $0.00.**
