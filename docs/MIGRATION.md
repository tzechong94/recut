# Migration audit — recut-v2 → recut (this repo)

Audited `~/recut-v2` against this plan. recut-v2 is a small TypeScript service:
Hono HTTP + an MCP server + Zod schemas, laid out as `src/{core,server,mcp,shared}`,
npm-locked, **not** Next.js, with no compiler, no manifest layer, no Series Bible, no
rigs, no canvas. It was built against a different plan (an MCP-driven generation service),
not the node-canvas / Series-Bible product this file specifies.

## Classification

| Module (recut-v2) | Verdict | Reason |
|---|---|---|
| `src/server` (Hono app) | **DELETE** | Plan is Next.js 15 App Router with route handlers under `app/api/`. Hono has no place; porting it means deleting it. |
| `src/mcp` (MCP server + tools) | **PORT (later)** | The tool-definition discipline (typed args, Zod-validated) is a good template for the Sprint 5 agent tools. Not needed before Sprint 5. Port patterns, not code. |
| `src/core` (DashScope calls) | **PORT (knowledge, not code)** | Contains real, validated DashScope request shapes + model-fact notes (region, endpoints). Invaluable as reference for `serializers/dashscope.ts` and `adapters/dashscope.ts` in Sprint 3. The code itself is coupled to Hono/MCP; lift the request shapes, not the files. |
| `src/shared` (Zod schemas) | **PORT (selectively)** | Some entity/asset schemas overlap with the Series Bible. Re-express as the plan's typed `CompiledPrompt` / `ModelManifest` rather than importing. |
| npm lockfile / `package.json` | **DELETE** | Plan mandates pnpm + Next. Mixing managers is disallowed. Fresh pnpm project. |
| `web/` (recut-v2) | **DELETE** | Vite/other; plan is Next App Router. |

## Ordered migration sequence (every step leaves the repo building)

1. **Greenfield scaffold** on the plan's stack (Next 15 / pnpm / TS strict / Tailwind). — *done, ~1h*
2. **Harness first** (gateway cache + budget governor + eval scripts). — *done, ~2h*
3. Sprint 1 vertical slice; lift **DashScope request shapes** from `recut-v2/src/core` into the serializer when Sprint 3 lands. — *~4h to port shapes*
4. Sprint 5: adapt **MCP tool-definition patterns** from `recut-v2/src/mcp` into the agent's tool layer. — *~2h*

Nothing else from recut-v2 is on the critical path.

## Verdict: rewrite, not migrate — and it is cheaper, by hour count.

A faithful in-place migration would mean: swap Hono→Next (delete + rewrite the server),
swap npm→pnpm (relock), introduce the entire compiler/manifest/bible/rig/canvas surface
that recut-v2 simply does not have, and reconcile a Zod-first data model with the plan's
typed `CompiledPrompt`. The parts worth keeping — DashScope request shapes and MCP tool
patterns — are **reference knowledge (~6h to port)**, not runnable modules. Migrating the
runnable code would cost more than deleting it, because ~80% of the plan's surface area has
no counterpart in recut-v2. **Estimated rewrite (harness + Sprint 1): ~3h done; migration of
equivalent scope: ~12h+ with a worse result.** Rewrite wins on hours and on cleanliness.

recut-v2 is retained on disk as a **reference and fallback**, per the standing note that the
old repos are fallbacks. It is not deleted; it is simply not the build target.
