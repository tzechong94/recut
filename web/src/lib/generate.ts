/**
 * AI-first generation orchestration: queue clips, poll their jobs, and refetch
 * the timeline once everything settles. Kept framework-free and side-effect
 * isolated (it talks to the api client + a sleeper) so it can be unit tested
 * with a mocked fetch.
 *
 * Graceful degradation is a first-class concern: if `/generate` 404s (stub /
 * offline backend) or jobs never finish, the run resolves with a status the UI
 * can surface instead of hanging forever.
 */
import { api, ApiError } from "../api/client";
import type { Job, Timeline } from "../types";

export type JobPhase = "queued" | "running" | "done" | "failed";

export interface JobState {
  id: string;
  phase: JobPhase;
  progress: number; // 0..1
  asset_id?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

export interface GenerateProgress {
  jobs: JobState[];
  done: number; // settled (done|failed) count
  total: number;
}

export type GenerateOutcome =
  | { kind: "unsupported"; reason: string } // /generate 404 / not implemented
  | { kind: "empty"; reason: string } // nothing queued (all replaced)
  | { kind: "timeout"; timeline: Timeline | null; progress: GenerateProgress }
  | { kind: "settled"; timeline: Timeline | null; progress: GenerateProgress };

export interface RunGenerationOpts {
  timelineId: string;
  /** Omit to generate every not-yet-replaced visual slot. */
  slotId?: string;
  voiceover?: boolean;
  /** Called on each poll with the latest per-job progress. */
  onProgress?: (p: GenerateProgress) => void;
  /** Poll interval in ms (default 3000). */
  intervalMs?: number;
  /** Safety cap so a stuck backend can't hang the UI (default 40 polls). */
  maxPolls?: number;
  /** Injectable sleeper (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

function settled(phase: JobPhase): boolean {
  return phase === "done" || phase === "failed";
}

function toPhase(status: string): JobPhase {
  if (status === "done") return "done";
  if (status === "failed" || status === "error") return "failed";
  if (status === "running") return "running";
  return "queued";
}

function fromJob(job: Job): JobState {
  return {
    id: job.id,
    phase: toPhase(job.status),
    progress: settled(toPhase(job.status)) ? 1 : (job.progress ?? 0),
    asset_id: job.result?.asset_id,
    skipped: job.result?.skipped,
    reason: job.result?.reason,
    error: job.error ?? undefined,
  };
}

function summarize(states: Map<string, JobState>): GenerateProgress {
  const jobs = [...states.values()];
  return {
    jobs,
    done: jobs.filter((j) => settled(j.phase)).length,
    total: jobs.length,
  };
}

/**
 * Queue generation, poll until every job settles (or we hit the safety cap),
 * then refetch the timeline so the freshly generated assets are attached.
 */
export async function runGeneration(
  opts: RunGenerationOpts,
): Promise<GenerateOutcome> {
  const {
    timelineId,
    slotId,
    voiceover,
    onProgress,
    intervalMs = 3000,
    maxPolls = 40,
    sleep = defaultSleep,
  } = opts;

  // 1) queue
  let jobIds: string[];
  try {
    const res = await api.generate(timelineId, { slotId, voiceover });
    jobIds = res.job_ids ?? [];
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { kind: "unsupported", reason: "Generation isn't available." };
    }
    return {
      kind: "unsupported",
      reason: err instanceof Error ? err.message : "Couldn't reach generation.",
    };
  }

  if (jobIds.length === 0) {
    return {
      kind: "empty",
      reason: "Nothing to generate — every slot is already your upload.",
    };
  }

  // 2) poll
  const states = new Map<string, JobState>(
    jobIds.map((id) => [id, { id, phase: "queued", progress: 0 }]),
  );
  onProgress?.(summarize(states));

  let polls = 0;
  while (polls < maxPolls) {
    polls += 1;
    await sleep(intervalMs);

    const results = await Promise.all(
      jobIds.map(async (id) => {
        const prev = states.get(id);
        if (prev && settled(prev.phase)) return prev; // don't re-poll finished
        try {
          return fromJob(await api.getJob(id));
        } catch {
          // a single failed poll shouldn't kill the run; keep prior state
          return prev ?? { id, phase: "queued" as JobPhase, progress: 0 };
        }
      }),
    );
    for (const s of results) states.set(s.id, s);
    onProgress?.(summarize(states));

    if ([...states.values()].every((s) => settled(s.phase))) {
      const timeline = await refetch(timelineId);
      return { kind: "settled", timeline, progress: summarize(states) };
    }
  }

  // hit the safety cap — surface a non-blocking timeout
  const timeline = await refetch(timelineId);
  return { kind: "timeout", timeline, progress: summarize(states) };
}

async function refetch(timelineId: string): Promise<Timeline | null> {
  try {
    return await api.getTimelineById(timelineId);
  } catch {
    return null;
  }
}
