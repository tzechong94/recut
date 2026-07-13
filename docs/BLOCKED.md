# Blocked / descoped log

## 2026-07-13 — Sprint 0 — package install blocked by corporate registry

**What's wrong:** `~/.npmrc` routes all installs to the corporate Synapxe Artifactory
(`packages.hip.synapxe.sg`), which returns 401/403 for `next`, `picomatch`, and other
public-npm packages. `pnpm install` cannot complete, so `typecheck` / `test` / `build`
cannot run yet.

**Confirmed:** public npm (`registry.npmjs.org`) is reachable (HTTP 200) and is what
`recut-v2` installed from. A project-local `.npmrc` pointing at public npm is the clean fix,
but writing it is blocked by a governance guardrail (rerouting around the corporate registry
requires the user to explicitly authorize the public registry).

**Status:** HALTED for user decision (not descoped). All Sprint 0 *code* is written and
internally consistent; only the install + gate-run is blocked. Zero dollars spent.

**Resolution options (user's call):**
1. Authorize the public npm registry for this project (approve the project `.npmrc`, or add a
   permission rule), then installs proceed.
2. Get `next` + the public-npm graph mirrored / the token scoped in Artifactory so the
   sanctioned registry serves them.
3. Build in an environment where public npm is the default (e.g. a container).
