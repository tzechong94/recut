import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gateway } from '../jobs';
import { BudgetGovernor } from '../budget';
import { jobHash } from '../hash';
import { GatewayCacheMiss, BudgetExceeded, BudgetUnset } from '../errors';

let dir: string;
let fixturesDir: string;
let ledgerPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'recut-harness-'));
  fixturesDir = join(dir, 'fixtures');
  ledgerPath = join(dir, 'spend.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('hash', () => {
  it('is deterministic and key-order independent', () => {
    const a = jobHash('m', { a: 1, b: { c: 2, d: 3 } }, 7);
    const b = jobHash('m', { b: { d: 3, c: 2 }, a: 1 }, 7);
    expect(a).toBe(b);
  });
  it('changes with seed', () => {
    expect(jobHash('m', { x: 1 }, 1)).not.toBe(jobHash('m', { x: 1 }, 2));
  });
});

describe('replay mode — zero network', () => {
  it('resolves a cached job WITHOUT invoking the live call', async () => {
    const gw = new Gateway({ mode: 'replay', fixturesDir });
    const hash = jobHash('qwen-image-2.0-pro', { prompt: 'hi' }, 42);
    mkdirSync(fixturesDir, { recursive: true });
    writeFileSync(
      join(fixturesDir, `${hash}.json`),
      JSON.stringify({ hash, modelId: 'qwen-image-2.0-pro', seed: 42, costUsd: 0.03, latencyMs: 10, payload: { url: 'x' } }),
    );

    let liveCalled = false;
    const result = await gw.run({
      modelId: 'qwen-image-2.0-pro',
      serializedPayload: { prompt: 'hi' },
      seed: 42,
      costUsd: 0.03,
      live: async () => {
        liveCalled = true;
        throw new Error('network must not be touched in replay');
      },
    });

    expect(liveCalled).toBe(false);
    expect(result.payload).toEqual({ url: 'x' });
  });

  it('throws GatewayCacheMiss and logs the hash to MISSING.md on a miss', async () => {
    const gw = new Gateway({ mode: 'replay', fixturesDir });
    await expect(
      gw.run({ modelId: 'wan2.7-image-pro', serializedPayload: { prompt: 'nope' }, costUsd: 0.05, live: async () => 1 }),
    ).rejects.toBeInstanceOf(GatewayCacheMiss);

    const missing = readFileSync(join(fixturesDir, 'MISSING.md'), 'utf8');
    expect(missing).toContain('wan2.7-image-pro');
    expect(missing).toContain(jobHash('wan2.7-image-pro', { prompt: 'nope' }, undefined));
  });
});

describe('budget governor', () => {
  function gov(cap: number | null) {
    return new BudgetGovernor({ ledgerPath, capUsd: cap });
  }

  it('refuses a live submit that would cross the cap, and never calls live', async () => {
    const governor = gov(8);
    governor.record(7.95); // near cap
    const gw = new Gateway({ mode: 'live', fixturesDir, governor, captureFixtures: false });

    let liveCalled = false;
    await expect(
      gw.run({
        modelId: 'qwen-image-2.0-pro',
        serializedPayload: { prompt: 'expensive' },
        costUsd: 0.5,
        live: async () => {
          liveCalled = true;
          return { url: 'y' };
        },
      }),
    ).rejects.toBeInstanceOf(BudgetExceeded);
    expect(liveCalled).toBe(false);
    expect(governor.spent()).toBeCloseTo(7.95, 5);
  });

  it('allows a submit under the cap, records spend, returns provenance', async () => {
    const governor = gov(8);
    const gw = new Gateway({ mode: 'live', fixturesDir, governor, captureFixtures: true });
    const result = await gw.run({
      modelId: 'qwen-image-2.0-pro',
      serializedPayload: { prompt: 'ok' },
      seed: 1,
      costUsd: 0.03,
      live: async () => ({ url: 'z' }),
    });
    expect(result.payload).toEqual({ url: 'z' });
    expect(result.costUsd).toBe(0.03);
    expect(governor.spent()).toBeCloseTo(0.03, 5);
    // captured for future replay
    expect(existsSync(join(fixturesDir, `${result.hash}.json`))).toBe(true);
  });

  it('fails closed when live mode has no cap set', () => {
    expect(() => gov(null).assertCanSpend(0.01)).toThrow(BudgetUnset);
  });
});
