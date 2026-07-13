import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { jobHash } from './hash';
import { BudgetGovernor } from './budget';
import { GatewayCacheMiss } from './errors';

export type RecutMode = 'replay' | 'live';

export function currentMode(): RecutMode {
  return process.env.RECUT_MODE === 'live' ? 'live' : 'replay';
}

/** A cached job result: whatever the provider returned, plus its provenance. */
export interface JobResult<T = unknown> {
  hash: string;
  modelId: string;
  seed: number | null;
  costUsd: number;
  latencyMs: number;
  payload: T;
}

export interface RunJobArgs<T> {
  modelId: string;
  /** provider-native serialized request; also the cache key material */
  serializedPayload: unknown;
  seed?: number;
  /** unit cost of ONE live call, in USD, for the governor */
  costUsd: number;
  /** the actual live call. Only invoked in live mode, only after the governor passes. */
  live: () => Promise<T>;
}

export interface GatewayOptions {
  fixturesDir?: string;
  governor?: BudgetGovernor;
  mode?: RecutMode;
  /** in live mode, write successful results back into fixtures/ for future replay */
  captureFixtures?: boolean;
}

/**
 * The one bridge to any model. Same content-addressed cache in replay and live.
 *
 *   replay: resolve fixtures/<hash>.json, NEVER touch the network. A miss throws
 *           GatewayCacheMiss, names the hash, and appends it to fixtures/MISSING.md.
 *   live:   governor.assertCanSpend() BEFORE the call; on success record spend and
 *           (optionally) capture the result as a fixture so replay works next time.
 */
export class Gateway {
  private readonly fixturesDir: string;
  private readonly governor: BudgetGovernor;
  private readonly mode: RecutMode;
  private readonly captureFixtures: boolean;

  constructor(opts?: GatewayOptions) {
    this.fixturesDir = resolve(opts?.fixturesDir ?? process.env.RECUT_FIXTURES_DIR ?? 'fixtures');
    this.governor = opts?.governor ?? new BudgetGovernor();
    this.mode = opts?.mode ?? currentMode();
    this.captureFixtures = opts?.captureFixtures ?? this.mode === 'live';
  }

  private fixturePath(hash: string): string {
    return join(this.fixturesDir, `${hash}.json`);
  }

  private recordMiss(hash: string, modelId: string): void {
    mkdirSync(this.fixturesDir, { recursive: true });
    const line = `- \`${hash}\` — ${modelId}\n`;
    const missPath = join(this.fixturesDir, 'MISSING.md');
    if (!existsSync(missPath)) {
      writeFileSync(missPath, `# Missing fixtures\n\nHashes requested in replay but not on disk. Batch-generate in live mode.\n\n`);
    }
    // de-dupe: don't append the same hash twice
    const existing = readFileSync(missPath, 'utf8');
    if (!existing.includes(hash)) appendFileSync(missPath, line);
  }

  async run<T>(args: RunJobArgs<T>): Promise<JobResult<T>> {
    const hash = jobHash(args.modelId, args.serializedPayload, args.seed);
    const path = this.fixturePath(hash);

    if (this.mode === 'replay') {
      if (!existsSync(path)) {
        this.recordMiss(hash, args.modelId);
        throw new GatewayCacheMiss(hash, args.modelId);
      }
      const cached = JSON.parse(readFileSync(path, 'utf8')) as JobResult<T>;
      return cached;
    }

    // live: governor gate BEFORE the call. Never overrun the cap.
    this.governor.assertCanSpend(args.costUsd);
    const startedAtMs = performanceNow();
    const payload = await args.live();
    const latencyMs = Math.round(performanceNow() - startedAtMs);
    this.governor.record(args.costUsd);

    const result: JobResult<T> = {
      hash,
      modelId: args.modelId,
      seed: args.seed ?? null,
      costUsd: args.costUsd,
      latencyMs,
      payload,
    };

    if (this.captureFixtures) {
      mkdirSync(this.fixturesDir, { recursive: true });
      writeFileSync(path, JSON.stringify(result, null, 2));
    }
    return result;
  }
}

// process.hrtime-based clock; avoids Date.now so tests stay deterministic-friendly.
function performanceNow(): number {
  const [s, ns] = process.hrtime();
  return s * 1000 + ns / 1e6;
}
