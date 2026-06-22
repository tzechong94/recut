/**
 * Typed fetch client for the Recut backend.
 * All endpoints live under `${API_BASE}/api`. Media bytes stream from
 * `${API_BASE}/api/assets/{id}/raw`.
 */
import type {
  Asset,
  CaptionCoverResult,
  CowriteReply,
  DraftScriptResult,
  Job,
  NewProject,
  Project,
  RefineResult,
  Recipe,
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

/* ----------------------------- Projects ----------------------------- */
export const api = {
  listProjects: () => request<Project[]>("/projects"),
  createProject: (body: NewProject) =>
    request<Project>("/projects", { method: "POST", body }),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  patchProject: (
    id: string,
    body: Partial<Pick<Project, "name" | "stage" | "tone">>,
  ) => request<Project>(`/projects/${id}`, { method: "PATCH", body }),
  deleteProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: "DELETE" }),

  /* ------------------------------ Assets ------------------------------ */
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

  /* ------------------------------ Recipe ------------------------------ */
  analyse: (projectId: string, assetId: string) =>
    request<Recipe>(`/projects/${projectId}/analyse`, {
      method: "POST",
      body: { asset_id: assetId },
    }),
  getRecipe: (recipeId: string) => request<Recipe>(`/recipes/${recipeId}`),
  recipeLibrary: () => request<Recipe[]>("/recipes/library"),
  saveRecipe: (recipeId: string, saved: boolean) =>
    request<Recipe>(`/recipes/${recipeId}/save`, {
      method: "POST",
      body: { saved },
    }),

  /* ----------------------------- Timeline ----------------------------- */
  baseCut: (projectId: string, recipeId: string) =>
    request<Timeline>(`/projects/${projectId}/base-cut`, {
      method: "POST",
      body: { recipe_id: recipeId },
    }),
  getTimeline: (projectId: string) =>
    request<Timeline>(`/projects/${projectId}/timeline`),
  getTimelineById: (id: string) => request<Timeline>(`/timelines/${id}`),
  putTimeline: (id: string, doc: Timeline) =>
    request<Timeline>(`/timelines/${id}`, { method: "PUT", body: doc }),
  uploadToSlot: (timelineId: string, slotId: string, assetId: string) =>
    request<Timeline>(`/timelines/${timelineId}/slots/${slotId}/upload`, {
      method: "POST",
      body: { asset_id: assetId },
    }),
  addSlot: (timelineId: string, afterSlotId: string, prompt: string) =>
    request<Timeline>(`/timelines/${timelineId}/slots`, {
      method: "POST",
      body: { after_slot_id: afterSlotId, prompt },
    }),

  /* ------------------------------- Jobs ------------------------------- */
  exportTimeline: (timelineId: string) =>
    request<{ job_id: string }>(`/timelines/${timelineId}/export`, {
      method: "POST",
    }),
  getJob: (id: string) => request<Job>(`/jobs/${id}`),
  /**
   * Queue AI generation. Omit slotId to generate a clip for every
   * not-yet-replaced visual slot; pass slotId to regenerate just that one.
   * Returns the queued job ids to poll via getJob.
   */
  generate: (
    timelineId: string,
    opts?: { slotId?: string; voiceover?: boolean },
  ) =>
    request<{ job_ids: string[]; queued: number }>(
      `/timelines/${timelineId}/generate`,
      {
        method: "POST",
        body: {
          ...(opts?.slotId ? { slot_id: opts.slotId } : {}),
          ...(opts?.voiceover !== undefined
            ? { voiceover: opts.voiceover }
            : {}),
        },
      },
    ),

  /* --------------------------- Agent / chat --------------------------- */
  cowrite: (projectId: string, message: string, recipeId: string) =>
    request<CowriteReply>(`/projects/${projectId}/cowrite`, {
      method: "POST",
      body: { message, recipe_id: recipeId },
    }),
  draftScript: (projectId: string, recipeId: string, story: string) =>
    request<DraftScriptResult>(`/projects/${projectId}/draft-script`, {
      method: "POST",
      body: { recipe_id: recipeId, story },
    }),
  refineSlot: (timelineId: string, slotId: string, instruction: string) =>
    request<RefineResult>(`/timelines/${timelineId}/slots/${slotId}/refine`, {
      method: "POST",
      body: { instruction },
    }),
  captionCover: (timelineId: string) =>
    request<CaptionCoverResult>(`/timelines/${timelineId}/caption-cover`, {
      method: "POST",
    }),
};

export { request as __request, buildUrl as __buildUrl };
