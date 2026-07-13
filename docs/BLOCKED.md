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

**RESOLVED:** user switched `~/.npmrc` to public npm; installs succeed.

## 2026-07-13 — Sprint 0 — 0.4 golden fixture set deferred to Sprint 1 (descoped, not blocked)

The content-addressed cache key is `sha256(modelId + serializedPayload + seed)`. The serialized
payload only exists once the compiler (Sprint 2) and serializer (Sprint 3) are built, so the
demo fixture hashes cannot be computed during Sprint 0. Deferring golden-fixture generation to
the first real compiled payloads (Sprint 1 vertical slice), generated live under the same $8
governor (~$6.86 remaining). Not critical to Sprint 0's harness gates; the replay layer +
`fixtures/MISSING.md` mechanism is the machinery that makes on-demand generation safe.

## 2026-07-13 — Sprint 0 — model-id substitution (resolved, logged for Sprint 3)

Plan's `qwen-image-2.0-pro` / `wan2.7-image-pro` are absent on the intl key. image.edit maps to
`qwen-image-edit` in the Sprint 3 manifest. Identity spike validated this substitution (HOLDS).
