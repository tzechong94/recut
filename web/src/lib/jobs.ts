/**
 * Job polling with linear backoff and a hard cap, plus a graceful-degradation
 * design: a single missed poll (network blip) doesn't abort — we only fail after
 * the cap, an explicit failed/error status, or an abort signal.
 *
 * The async drama jobs (cast, produce, regenerate) return {job_id}; the UI polls
 * GET /jobs/{id} until done, then refetches the production to see the result.
 */
import { api } from "../api/client";
import type { Job } from "../types";

export interface PollOptions {
  /** First delay in ms (grows by `step` each tick up to `maxIntervalMs`). */
  intervalMs?: number;
  step?: number;
  maxIntervalMs?: number;
  /** Hard cap on total wall time before giving up. */
  timeoutMs?: number;
  onProgress?: (job: Job) => void;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to api.getJob. */
  getJob?: (id: string) => Promise<Job>;
  /** Injectable for tests; defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

export function isTerminal(status: string): boolean {
  return status === "done" || status === "failed" || status === "error";
}

/**
 * Poll a job until it reaches a terminal state. Resolves with the final Job on
 * "done"; rejects on "failed"/"error", abort, or timeout.
 */
export async function pollJob(
  jobId: string,
  opts: PollOptions = {},
): Promise<Job> {
  const {
    intervalMs = 1000,
    step = 400,
    maxIntervalMs = 4000,
    timeoutMs = 10 * 60 * 1000,
    onProgress,
    signal,
    getJob = api.getJob,
    sleep = defaultSleep,
  } = opts;

  const started = Date.now();
  let delay = intervalMs;
  let consecutiveErrors = 0;

  for (;;) {
    if (signal?.aborted) throw new Error("aborted");
    if (Date.now() - started > timeoutMs) {
      throw new Error("job timed out");
    }

    let job: Job | null = null;
    try {
      job = await getJob(jobId);
      consecutiveErrors = 0;
    } catch (err) {
      // Tolerate transient fetch failures; bail only after several in a row.
      consecutiveErrors += 1;
      if (consecutiveErrors >= 5) throw err;
    }

    if (job) {
      onProgress?.(job);
      if (job.status === "done") return job;
      if (job.status === "failed" || job.status === "error") {
        throw new Error(job.error || "job failed");
      }
    }

    await sleep(delay);
    delay = Math.min(maxIntervalMs, delay + step);
  }
}
