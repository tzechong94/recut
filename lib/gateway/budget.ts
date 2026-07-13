import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { BudgetExceeded, BudgetUnset } from './errors';

/**
 * The spend governor. Cumulative spend is persisted to a machine-local ledger
 * (.recut/spend.json, gitignored). Every live submit checks the cap BEFORE the
 * call; the submitter refuses once spend would cross it. There is no override.
 */
export class BudgetGovernor {
  private readonly ledgerPath: string;
  private readonly capUsd: number | null;

  constructor(opts?: { ledgerPath?: string; capUsd?: number | null }) {
    this.ledgerPath = resolve(opts?.ledgerPath ?? process.env.RECUT_SPEND_LEDGER ?? '.recut/spend.json');
    if (opts?.capUsd !== undefined) {
      this.capUsd = opts.capUsd;
    } else {
      const raw = process.env.RECUT_BUDGET_USD;
      this.capUsd = raw === undefined || raw === '' ? null : Number(raw);
    }
  }

  spent(): number {
    if (!existsSync(this.ledgerPath)) return 0;
    try {
      const parsed = JSON.parse(readFileSync(this.ledgerPath, 'utf8')) as { spentUsd?: number };
      return typeof parsed.spentUsd === 'number' ? parsed.spentUsd : 0;
    } catch {
      return 0;
    }
  }

  cap(): number | null {
    return this.capUsd;
  }

  remaining(): number {
    if (this.capUsd === null) return Infinity;
    return Math.max(0, this.capUsd - this.spent());
  }

  /** Throws if a live submit of `costUsd` is not permitted. Call before the API call. */
  assertCanSpend(costUsd: number): void {
    if (this.capUsd === null) throw new BudgetUnset();
    const spent = this.spent();
    if (spent + costUsd > this.capUsd + 1e-9) {
      throw new BudgetExceeded(spent, costUsd, this.capUsd);
    }
  }

  /** Persist actual spend after a successful live call. */
  record(costUsd: number): void {
    const next = this.spent() + costUsd;
    mkdirSync(dirname(this.ledgerPath), { recursive: true });
    writeFileSync(this.ledgerPath, JSON.stringify({ spentUsd: next, updatedAt: null }, null, 2));
  }
}
