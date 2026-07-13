// Named exceptions. No bare throws of strings anywhere in the gateway.

/** Replay mode asked for a hash that isn't in fixtures/. Names the hash. */
export class GatewayCacheMiss extends Error {
  constructor(
    readonly hash: string,
    readonly modelId: string,
  ) {
    super(`replay cache miss: ${hash} (model ${modelId}) — not in fixtures/. Appended to fixtures/MISSING.md.`);
    this.name = 'GatewayCacheMiss';
  }
}

/** A live submit would push cumulative spend past RECUT_BUDGET_USD. Never overrun. */
export class BudgetExceeded extends Error {
  constructor(
    readonly spentUsd: number,
    readonly costUsd: number,
    readonly capUsd: number,
  ) {
    super(
      `budget governor refused submit: spent $${spentUsd.toFixed(4)} + $${costUsd.toFixed(4)} > cap $${capUsd.toFixed(2)}`,
    );
    this.name = 'BudgetExceeded';
  }
}

/** Live mode requested but RECUT_BUDGET_USD is unset. Fail closed. */
export class BudgetUnset extends Error {
  constructor() {
    super('RECUT_MODE=live requires RECUT_BUDGET_USD to be set. Refusing to submit uncapped.');
    this.name = 'BudgetUnset';
  }
}
