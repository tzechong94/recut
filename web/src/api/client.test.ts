import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, API_BASE, assetRawUrl } from "./client";

function mockResponse(body: unknown, init: Partial<Response> = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? "OK",
    json: async () => body,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as unknown as Response;
}

describe("showrunner api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("GET /styles hits the /api base with GET", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse([{ name: "noir" }]));
    const res = await api.listStyles();
    expect(res).toEqual([{ name: "noir" }]);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/styles`);
    expect(opts.method).toBe("GET");
  });

  it("POST /productions sends JSON body + content-type", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ id: "prod_1" }, { status: 201 }),
    );
    await api.createProduction({
      premise: "A lighthouse keeper",
      target_seconds: 45,
      style: "noir",
    });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/productions`);
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({
      premise: "A lighthouse keeper",
      target_seconds: 45,
      style: "noir",
    });
  });

  it("PUT /productions/{id} serializes the full doc", async () => {
    const doc = { id: "prod_1", title: "X" } as never;
    fetchMock.mockResolvedValueOnce(mockResponse({ id: "prod_1" }));
    await api.saveProduction("prod_1", doc);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/productions/prod_1`);
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body).id).toBe("prod_1");
  });

  it("DELETE uses the right verb and handles 204", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(undefined, { status: 204 }));
    await api.deleteProduction("prod_1");
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${API_BASE}/api/productions/prod_1`,
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("POST /cast sends target + target_id", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ job_id: "j1" }));
    const res = await api.cast("prod_1", "character", "char_1");
    expect(res).toEqual({ job_id: "j1" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/productions/prod_1/cast`);
    expect(JSON.parse(opts.body)).toEqual({
      target: "character",
      target_id: "char_1",
    });
  });

  it("POST /shots/{sid}/regenerate hits the regenerate endpoint", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ job_id: "j2" }));
    await api.regenerateShot("prod_1", "shot_9");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${API_BASE}/api/productions/prod_1/shots/shot_9/regenerate`,
    );
    expect(opts.method).toBe("POST");
  });

  it("POST /characters/{cid}/rename sends the new name and returns the production", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ id: "prod_1", title: "X" }),
    );
    const res = await api.renameCharacter("prod_1", "char_1", "Mara");
    expect(res).toEqual({ id: "prod_1", title: "X" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${API_BASE}/api/productions/prod_1/characters/char_1/rename`,
    );
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({ name: "Mara" });
  });

  it("POST /revise sends the instruction and returns the production", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ id: "prod_1", logline: "noir now" }),
    );
    const res = await api.reviseProduction("prod_1", "make it noir");
    expect(res).toEqual({ id: "prod_1", logline: "noir now" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/productions/prod_1/revise`);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ instruction: "make it noir" });
  });

  it("GET /scoreboard returns the ledger payload", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ tokens: { total: 10 }, shots_total: 3 }),
    );
    const sb = await api.getScoreboard("prod_1");
    expect(sb.shots_total).toBe(3);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${API_BASE}/api/productions/prod_1/scoreboard`,
    );
  });

  it("GET /eval returns the proof payload from the eval endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        narrative: { overall: 0.88, scores: { stakes: 0.83 }, notes: "ok" },
        tokens: {
          total: 133000,
          video_tokens: 120000,
          video_tokens_pre_approval: 0,
          rerolls: 2,
          baseline_estimate: 400000,
          estimated_saved: 267000,
        },
        avg_consistency: 0.91,
      }),
    );
    const ev = await api.getEval("prod_1");
    expect(ev.narrative.overall).toBe(0.88);
    expect(ev.tokens.video_tokens_pre_approval).toBe(0);
    expect(ev.avg_consistency).toBe(0.91);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/productions/prod_1/eval`);
    expect(opts.method).toBe("GET");
  });

  it("upload sends multipart FormData (no JSON content-type) with kind query", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ id: "a1" }));
    const file = new File(["data"], "ref.png", { type: "image/png" });
    await api.uploadAsset("proj_1", file, "upload");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/projects/proj_1/assets?kind=upload`);
    expect(opts.body).toBeInstanceOf(FormData);
    expect((opts.body as FormData).get("file")).toBeInstanceOf(File);
    expect(opts.headers["Content-Type"]).toBeUndefined();
  });

  it("throws ApiError with detail on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(
        { detail: "production not found" },
        { status: 404, statusText: "Not Found" },
      ),
    );
    await expect(api.getProduction("nope")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "production not found",
    });
  });

  it("ApiError is the thrown type", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 500 }));
    await expect(api.getScoreboard("x")).rejects.toBeInstanceOf(ApiError);
  });

  it("assetRawUrl points at the raw stream endpoint", () => {
    expect(assetRawUrl("a9")).toBe(`${API_BASE}/api/assets/a9/raw`);
  });
});
