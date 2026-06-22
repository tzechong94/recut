import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGeneration } from "./generate";
import { API_BASE } from "../api/client";

function res(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    json: async () => body,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as unknown as Response;
}

const noSleep = () => Promise.resolve();

describe("runGeneration", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("generate -> running -> done -> refetch returns the updated timeline", async () => {
    const updatedTimeline = {
      timeline_id: "tl1",
      slots: [{ id: "s1", source: "generated", asset_id: "a1", status: "ready" }],
    };
    // 1) POST /generate
    fetchMock.mockResolvedValueOnce(res({ job_ids: ["j1"], queued: 1 }));
    // 2) first poll: running
    fetchMock.mockResolvedValueOnce(
      res({ id: "j1", status: "running", progress: 0.4, result: null, error: null }),
    );
    // 3) second poll: done
    fetchMock.mockResolvedValueOnce(
      res({
        id: "j1",
        status: "done",
        progress: 1,
        result: { asset_id: "a1" },
        error: null,
      }),
    );
    // 4) GET /timelines/tl1 refetch
    fetchMock.mockResolvedValueOnce(res(updatedTimeline));

    const progressSeen: number[] = [];
    const outcome = await runGeneration({
      timelineId: "tl1",
      sleep: noSleep,
      onProgress: (p) => progressSeen.push(p.done),
    });

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") throw new Error("expected settled");
    expect(outcome.timeline).toEqual(updatedTimeline);
    expect(outcome.progress.done).toBe(1);
    expect(outcome.progress.total).toBe(1);
    expect(outcome.progress.jobs[0].asset_id).toBe("a1");

    // verify the call sequence
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/api/timelines/tl1/generate`);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[1][0]).toBe(`${API_BASE}/api/jobs/j1`);
    expect(fetchMock.mock.calls[3][0]).toBe(`${API_BASE}/api/timelines/tl1`);
    // progress advanced from 0 -> 1
    expect(progressSeen[progressSeen.length - 1]).toBe(1);
  });

  it("regenerate one slot posts slot_id and settles", async () => {
    fetchMock.mockResolvedValueOnce(res({ job_ids: ["jX"], queued: 1 }));
    fetchMock.mockResolvedValueOnce(
      res({ id: "jX", status: "done", progress: 1, result: { asset_id: "a9" }, error: null }),
    );
    fetchMock.mockResolvedValueOnce(res({ timeline_id: "tl1", slots: [] }));

    const outcome = await runGeneration({
      timelineId: "tl1",
      slotId: "s2",
      sleep: noSleep,
    });
    expect(outcome.kind).toBe("settled");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ slot_id: "s2" });
  });

  it("treats a 404 on /generate as unsupported and does not hang", async () => {
    fetchMock.mockResolvedValueOnce(res({ detail: "nope" }, 404));
    const outcome = await runGeneration({ timelineId: "tl1", sleep: noSleep });
    expect(outcome.kind).toBe("unsupported");
    expect(fetchMock).toHaveBeenCalledTimes(1); // never polled
  });

  it("returns empty when nothing is queued", async () => {
    fetchMock.mockResolvedValueOnce(res({ job_ids: [], queued: 0 }));
    const outcome = await runGeneration({ timelineId: "tl1", sleep: noSleep });
    expect(outcome.kind).toBe("empty");
  });

  it("times out (without hanging) when a job never settles", async () => {
    fetchMock.mockResolvedValueOnce(res({ job_ids: ["jStuck"], queued: 1 }));
    // every poll returns running
    fetchMock.mockResolvedValue(
      res({ id: "jStuck", status: "running", progress: 0.5, result: null, error: null }),
    );

    const outcome = await runGeneration({
      timelineId: "tl1",
      sleep: noSleep,
      maxPolls: 3,
    });
    expect(outcome.kind).toBe("timeout");
    if (outcome.kind !== "timeout") throw new Error("expected timeout");
    expect(outcome.progress.done).toBe(0);
  });

  it("a failed job still settles the run", async () => {
    fetchMock.mockResolvedValueOnce(res({ job_ids: ["jF"], queued: 1 }));
    fetchMock.mockResolvedValueOnce(
      res({ id: "jF", status: "failed", progress: 0, result: { reason: "model error" }, error: "boom" }),
    );
    fetchMock.mockResolvedValueOnce(res({ timeline_id: "tl1", slots: [] }));

    const outcome = await runGeneration({ timelineId: "tl1", sleep: noSleep });
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") throw new Error("expected settled");
    expect(outcome.progress.jobs[0].phase).toBe("failed");
    expect(outcome.progress.done).toBe(1);
  });
});
