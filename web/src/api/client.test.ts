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

describe("api client request building", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("GET /projects hits the /api base with GET", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse([{ id: "p1" }]));
    const res = await api.listProjects();
    expect(res).toEqual([{ id: "p1" }]);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/projects`);
    expect(opts.method).toBe("GET");
  });

  it("POST /projects sends JSON body + content-type", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ id: "p2", name: "X" }, { status: 201 }),
    );
    await api.createProject({ name: "X", tone: "#fff" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/projects`);
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({ name: "X", tone: "#fff" });
  });

  it("PATCH and DELETE use the right verbs", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ id: "p1", name: "Y" }));
    await api.patchProject("p1", { name: "Y" });
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");

    fetchMock.mockResolvedValueOnce(
      mockResponse(undefined, { status: 204 }),
    );
    await api.deleteProject("p1");
    expect(fetchMock.mock.calls[1][0]).toBe(`${API_BASE}/api/projects/p1`);
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  });

  it("upload sends multipart FormData (no JSON content-type) with kind query", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ id: "a1" }));
    const file = new File(["data"], "clip.mp4", { type: "video/mp4" });
    await api.uploadAsset("p1", file, "reference");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/projects/p1/assets?kind=reference`);
    expect(opts.body).toBeInstanceOf(FormData);
    expect((opts.body as FormData).get("file")).toBeInstanceOf(File);
    expect(opts.headers["Content-Type"]).toBeUndefined();
  });

  it("PUT /timelines/{id} serializes the full doc", async () => {
    const doc = { timeline_id: "tl1", slots: [] } as never;
    fetchMock.mockResolvedValueOnce(mockResponse({ timeline_id: "tl1" }));
    await api.putTimeline("tl1", doc);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/timelines/tl1`);
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body).timeline_id).toBe("tl1");
  });

  it("throws ApiError with detail on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ detail: "not found" }, { status: 404, statusText: "Not Found" }),
    );
    await expect(api.getProject("nope")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "not found",
    });
  });

  it("ApiError is the thrown type", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 500 }));
    await expect(api.getRecipe("r")).rejects.toBeInstanceOf(ApiError);
  });

  it("assetRawUrl points at the raw stream endpoint", () => {
    expect(assetRawUrl("a9")).toBe(`${API_BASE}/api/assets/a9/raw`);
  });
});
