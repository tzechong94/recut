/**
 * Typed fetch client for the Recut AI Showrunner backend.
 * All endpoints live under `${API_BASE}/api`. Media bytes stream from
 * `${API_BASE}/api/assets/{id}/raw`.
 */
import type {
  Asset,
  Job,
  Production,
  ProductionEval,
  ProductionSummary,
  Scoreboard,
  StyleSummary,
  Timeline,
} from "../types";

export const API_BASE: string =
  (import.meta.env?.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ||
  "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Public URL to stream an asset's bytes (use as a media src in dev). */
export function assetRawUrl(assetId: string): string {
  return `${API_BASE}/api/assets/${assetId}/raw`;
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOpts["query"]): string {
  const url = new URL(`${API_BASE}/api${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = "GET", body, query, signal } = opts;
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;

  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: payload,
    signal,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = (data && (data.detail || data.message)) || detail;
    } catch {
      /* non-json error body */
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  /* ------------------------------- Styles ------------------------------- */
  listStyles: () => request<StyleSummary[]>("/styles"),

  /* ------------------------------ Premise ------------------------------- */
  suggestPremise: (premise = "") =>
    request<{ premise: string }>("/premise/suggest", { method: "POST", body: { premise } }),

  /* ---------------------------- Productions ----------------------------- */
  createProduction: (body: {
    premise: string;
    target_seconds: number;
    style: string;
  }) => request<Production>("/productions", { method: "POST", body }),
  listProductions: () => request<ProductionSummary[]>("/productions"),
  getProduction: (id: string) => request<Production>(`/productions/${id}`),
  deleteProduction: (id: string) =>
    request<void>(`/productions/${id}`, { method: "DELETE" }),
  /** Persist all inline edits / autosave. Sends the full Production doc. */
  saveProduction: (id: string, doc: Production) =>
    request<Production>(`/productions/${id}`, { method: "PUT", body: doc }),

  storyboard: (id: string) =>
    request<Production>(`/productions/${id}/storyboard`, { method: "POST" }),

  /** Generate a character/location reference image. Async — poll the job. */
  cast: (id: string, target: "character" | "location", targetId: string) =>
    request<{ job_id: string }>(`/productions/${id}/cast`, {
      method: "POST",
      body: { target, target_id: targetId },
    }),

  /**
   * Rename a character — the backend propagates the new name across the whole
   * script (logline, question, theme, scene beats, every dialogue line + action)
   * and returns the FULL updated Production. Use this instead of the generic PUT
   * for name changes so the propagation lands everywhere at once.
   */
  renameCharacter: (id: string, cid: string, name: string) =>
    request<Production>(`/productions/${id}/characters/${cid}/rename`, {
      method: "POST",
      body: { name },
    }),

  /**
   * Send a plain-English director's note to the writers' room ("make it noir",
   * "merge the two sisters", "rename Eli to Mara and make her a botanist"). The
   * writer rewrites the treatment consistently and returns the FULL updated
   * Production (also appends to writers_room and may add a warnings entry).
   */
  reviseProduction: (id: string, instruction: string) =>
    request<Production>(`/productions/${id}/revise`, {
      method: "POST",
      body: { instruction },
    }),

  /** Attach a human-uploaded reference image to a character. */
  attachCharacterReference: (
    id: string,
    cid: string,
    assetId: string,
    referenceUrl?: string,
  ) =>
    request<Production>(`/productions/${id}/characters/${cid}/reference`, {
      method: "POST",
      body: { asset_id: assetId, reference_url: referenceUrl },
    }),

  produce: (id: string) =>
    request<{ job_id: string }>(`/productions/${id}/produce`, {
      method: "POST",
    }),
  regenerateShot: (id: string, sid: string) =>
    request<{ job_id: string }>(
      `/productions/${id}/shots/${sid}/regenerate`,
      { method: "POST" },
    ),

  getTimeline: (id: string) =>
    request<Timeline>(`/productions/${id}/timeline`),
  getScoreboard: (id: string) =>
    request<Scoreboard>(`/productions/${id}/scoreboard`),
  /** Closing proof: narrative rubric + honest token facts + avg consistency. */
  getEval: (id: string) =>
    request<ProductionEval>(`/productions/${id}/eval`),

  /* ------------------------------- Jobs --------------------------------- */
  getJob: (id: string) => request<Job>(`/jobs/${id}`),

  /* ------------------------------ Assets -------------------------------- */
  uploadAsset: (projectId: string, file: File, kind = "upload") => {
    const fd = new FormData();
    fd.append("file", file);
    return request<Asset>(`/projects/${projectId}/assets`, {
      method: "POST",
      body: fd,
      query: { kind },
    });
  },
  getAsset: (id: string) => request<Asset>(`/assets/${id}`),
};

export { request as __request, buildUrl as __buildUrl };
