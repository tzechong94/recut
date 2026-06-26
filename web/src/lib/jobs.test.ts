import { describe, expect, it, vi } from "vitest";
import { isTerminal, pollJob } from "./jobs";
import type { Job } from "../types";

function job(over: Partial<Job>): Job {
  return { id: "j1", status: "queued", progress: 0, result: null, error: null, ...over };
}

const noSleep = () => Promise.resolve();

describe("pollJob", () => {
  it("polls queued -> running -> done and resolves with the final job", async () => {
    const statuses: Job[] = [
      job({ status: "queued", progress: 0 }),
      job({ status: "running", progress: 0.5 }),
      job({ status: "done", progress: 1, result: { export_asset_id: "a1" } }),
    ];
    const getJob = vi.fn(async () => statuses.shift()!);
    const onProgress = vi.fn();

    const result = await pollJob("j1", { getJob, sleep: noSleep, onProgress });

    expect(result.status).toBe("done");
    expect(result.result?.export_asset_id).toBe("a1");
    expect(getJob).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it("rejects when the job fails, surfacing the error", async () => {
    const getJob = vi.fn(async () =>
      job({ status: "failed", error: "model unavailable" }),
    );
    await expect(
      pollJob("j1", { getJob, sleep: noSleep }),
    ).rejects.toThrow("model unavailable");
  });

  it("tolerates transient fetch errors then succeeds", async () => {
    let n = 0;
    const getJob = vi.fn(async () => {
      n += 1;
      if (n <= 2) throw new Error("network blip");
      return job({ status: "done", progress: 1 });
    });
    const result = await pollJob("j1", { getJob, sleep: noSleep });
    expect(result.status).toBe("done");
    expect(getJob).toHaveBeenCalledTimes(3);
  });

  it("gives up after repeated consecutive errors", async () => {
    const getJob = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(pollJob("j1", { getJob, sleep: noSleep })).rejects.toThrow(
      "down",
    );
    expect(getJob).toHaveBeenCalledTimes(5);
  });

  it("times out when the job never finishes", async () => {
    let t = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      t += 5000; // each call advances the clock 5s
      return t;
    });
    const getJob = vi.fn(async () => job({ status: "running", progress: 0.3 }));
    await expect(
      pollJob("j1", { getJob, sleep: noSleep, timeoutMs: 10000 }),
    ).rejects.toThrow(/timed out/);
    nowSpy.mockRestore();
  });

  it("isTerminal recognizes done/failed/error only", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("error")).toBe(true);
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("queued")).toBe(false);
  });
});
