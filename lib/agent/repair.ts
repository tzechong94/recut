// Auto-repair: when a take's Continuity Score is below threshold, append the critic's repair
// instruction, strengthen the reference conditioning, re-render, re-critique. Capped at 2
// retries. Returns the best take seen (never worse than the original).

import type { ContinuityVerdict } from './critic';
import { continuityScore, CONTINUITY_THRESHOLD } from './critic';

export interface RepairAttempt {
  takeUrl: string;
  verdict: ContinuityVerdict;
  score: number;
}

export interface RepairOutcome {
  best: RepairAttempt;
  attempts: number;
  repaired: boolean; // crossed threshold via repair (i.e. started below, ended at/above)
  history: RepairAttempt[];
}

export interface RepairDeps {
  /** re-render the shot given the strengthened refs + an appended repair instruction */
  renderFn: (refUrls: string[], repairInstruction: string, attempt: number) => Promise<string>;
  /** critique a take → verdict */
  critiqueFn: (takeUrl: string) => Promise<ContinuityVerdict>;
  maxRetries?: number;
  threshold?: number;
}

export async function autoRepair(
  initial: RepairAttempt,
  refUrls: string[],
  deps: RepairDeps,
): Promise<RepairOutcome> {
  const threshold = deps.threshold ?? CONTINUITY_THRESHOLD;
  const maxRetries = deps.maxRetries ?? 2;
  const history: RepairAttempt[] = [initial];
  let best = initial;

  const startedBelow = initial.score < threshold;
  let attempt = 0;
  while (best.score < threshold && attempt < maxRetries) {
    attempt++;
    const instruction = best.verdict.repair_instruction || 'Match the locked reference exactly.';
    const takeUrl = await deps.renderFn(refUrls, instruction, attempt);
    const verdict = await deps.critiqueFn(takeUrl);
    const candidate: RepairAttempt = { takeUrl, verdict, score: continuityScore(verdict) };
    history.push(candidate);
    if (candidate.score > best.score) best = candidate; // never regress
  }

  return { best, attempts: attempt, repaired: startedBelow && best.score >= threshold, history };
}
