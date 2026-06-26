/**
 * TypeScript mirrors of the backend pydantic schemas.
 *
 * Two domains live here:
 *  - The Showrunner drama domain (recut.showrunner.schemas): Production / Scene /
 *    Shot / Character / Location — the creative model the UI edits.
 *  - The render Timeline (recut.core.schemas): the execution format the
 *    PreviewPlayer + ffmpeg export read. A Production compiles down to it, so the
 *    preview is the SAME timeline the export renders.
 */

/* ============================ Projects / Assets ============================ */
export interface Asset {
  id: string;
  mime: string;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  url: string;
  kind?: string;
  [key: string]: unknown;
}

/* ================================ Jobs ==================================== */
export interface JobResult {
  asset_id?: string;
  export_asset_id?: string;
  url?: string;
  tokens?: number;
  [key: string]: unknown;
}

export interface Job {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "error" | string;
  progress: number;
  result: JobResult | null;
  error: string | null;
}

/* ============================ Showrunner domain =========================== */
export type Stage =
  | "premise"
  | "script"
  | "cast_style"
  | "storyboard"
  | "production"
  | "export";

export type AssetSource = "none" | "generated" | "uploaded" | "standin";

export type ShotStatus =
  | "planned"
  | "standin"
  | "generating"
  | "ready"
  | "failed";

export type ShotType = "wide" | "medium" | "close_up" | "insert" | "two_shot";

export type CameraMove =
  | "static"
  | "pan"
  | "push_in"
  | "pull_out"
  | "handheld"
  | "aerial";

export interface StyleSummary {
  name: string;
  descriptors: string;
  palette: string;
}

export interface StyleLock extends StyleSummary {
  locked: boolean;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  role: string;
  reference_asset_id?: string | null;
  reference_url?: string | null;
  source: AssetSource;
  locked: boolean;
  voice: string;
}

export interface Location {
  id: string;
  name: string;
  description: string;
  reference_asset_id?: string | null;
  reference_url?: string | null;
  source: AssetSource;
  locked: boolean;
}

export interface DialogueLine {
  character_id?: string | null;
  character_name: string;
  line: string;
}

export interface Shot {
  id: string;
  index: number;
  shot_type: ShotType;
  camera: CameraMove;
  action: string;
  dialogue: DialogueLine[];
  narration: string;
  character_ids: string[];
  location_id?: string | null;
  duration_s: number;
  source: AssetSource;
  asset_id?: string | null;
  status: ShotStatus;
  gen_prompt?: string;
  gen_tool?: string;
  tokens?: number;
  critic_score?: number | null;
  reroll_count: number;
}

export interface Scene {
  id: string;
  index: number;
  heading: string;
  summary: string;
  shots: Shot[];
}

export interface ProductionTokenLedger {
  text_tokens: number;
  image_tokens: number;
  video_tokens: number;
  voice_tokens: number;
  rerolls: number;
}

export interface WritersRoomEntry {
  role: string;
  text: string;
  score?: number | null;
}

export interface Production {
  id: string;
  project_id: string | null;
  premise: string;
  logline: string;
  title: string;
  target_seconds: number;
  stage: Stage;
  style: StyleLock;
  characters: Character[];
  locations: Location[];
  scenes: Scene[];
  token_ledger: ProductionTokenLedger;
  writers_room: WritersRoomEntry[];
  version: number;
  created_at?: number;
}

/** Compact production summary returned by GET /productions. */
export interface ProductionSummary {
  id: string;
  title: string;
  stage: Stage;
  updated_at?: string | number;
  [key: string]: unknown;
}

export interface Scoreboard {
  tokens: {
    text: number;
    image: number;
    video: number;
    voice: number;
    total: number;
  };
  rerolls: number;
  naive_baseline_tokens: number;
  tokens_saved: number;
  savings_pct: number;
  shots_ready: number;
  shots_total: number;
  avg_consistency: number | null;
  duration_s: number;
}

/* ============================== Render Timeline =========================== */
/* Read by the PreviewPlayer (and the ffmpeg export). A Production compiles to
 * this via the backend's /timeline endpoint. */
export type SlotType = "text" | "talk" | "roll" | "broll";
export type TextRole = "on_screen_text" | "voiceover" | "none";
export type SlotFont = "display" | "clean" | "mono";
export type SlotSize = "s" | "m" | "l";
export type SlotAlign = "left" | "center" | "right";
export type SlotSource = "standin" | "user_upload" | "generated";

export interface SlotStyle {
  font: SlotFont;
  size: SlotSize;
  align: SlotAlign;
}

export interface SlotStandin {
  kind: string;
  color: string;
  label: string;
}

export interface Slot {
  id: string;
  beat_label: string;
  type: SlotType;
  order?: number;
  duration_s: number;
  source: SlotSource;
  asset_id: string | null;
  standin?: SlotStandin;
  text: string;
  text_role: TextRole;
  style: SlotStyle;
  status: string;
  kept?: boolean;
  [key: string]: unknown;
}

export interface AudioTrack {
  asset_id: string | null;
  enabled: boolean;
  gain_db?: number;
}

export interface TimelineAudio {
  voiceover: AudioTrack;
  bed: AudioTrack;
}

export interface MusicSync {
  enabled: boolean;
  bpm: number;
  downbeat_offset_s: number;
}

export interface Timeline {
  timeline_id: string;
  project_id: string | null;
  version: number;
  aspect_ratio: "9:16";
  fps: number;
  audio: TimelineAudio;
  slots: Slot[];
  token_ledger?: unknown;
  music_sync: MusicSync | null;
}
