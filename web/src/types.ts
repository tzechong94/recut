/**
 * TypeScript mirrors of the backend pydantic schemas (recut.core.schemas).
 * Keep these in sync with the frozen API contract. The Timeline is the single
 * source of truth read by both the live preview and the export.
 */

export type Stage = number; // 0..4 index into STAGES

export type Tone = string; // hex color

/* ----------------------------- Projects ----------------------------- */
export interface Project {
  id: string;
  name: string;
  stage: number;
  tone: Tone;
  token_cap: number;
  created_at: string;
  updated_at: string;
}

export interface NewProject {
  name: string;
  tone: Tone;
}

/* ------------------------------ Assets ------------------------------ */
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

/* ------------------------------ Recipe ------------------------------ */
export type SlotType = "text" | "talk" | "roll" | "broll";
export type TextRole = "on_screen_text" | "voiceover" | "none";

export interface RecipeBeat {
  index: number;
  label: string;
  slot_type: SlotType;
  start_s: number;
  duration_s: number;
  pattern: string;
  text_role: TextRole;
  transcript_excerpt: string;
  on_screen_text: string;
  style_hint: string;
}

export interface Recipe {
  recipe_id: string;
  name: string;
  duration_s: number;
  shot_count: number;
  aspect_ratio: string;
  beats: RecipeBeat[];
  observations: string[];
  hook_transcript: string;
  analysis_meta: Record<string, unknown>;
  saved?: boolean;
}

/* ----------------------------- Timeline ----------------------------- */
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

export interface SlotGeneration {
  status?: string;
  job_id?: string | null;
  [key: string]: unknown;
}

export interface Slot {
  id: string;
  beat_label: string;
  type: SlotType;
  order: number;
  duration_s: number;
  source: SlotSource;
  asset_id: string | null;
  standin: SlotStandin;
  text: string;
  text_role: TextRole;
  style: SlotStyle;
  status: string;
  generation: SlotGeneration | null;
  kept: boolean;
}

export interface TokenLedger {
  real_footage_s: number;
  generated_s: number;
  standin_s: number;
  tokens_spent: number;
  naive_baseline_tokens: number;
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
  project_id: string;
  version: number;
  aspect_ratio: "9:16";
  fps: number;
  audio: TimelineAudio;
  slots: Slot[];
  token_ledger: TokenLedger;
  music_sync: MusicSync | null;
}

/* ------------------------------- Jobs ------------------------------- */
export interface Job {
  id: string;
  status: "queued" | "running" | "done" | "error" | string;
  progress: number;
  result: { asset_id?: string; url?: string } | null;
  error: string | null;
}

/* --------------------------- Agent / chat --------------------------- */
export interface CowriteReply {
  reply: string;
  beats?: { index: number; text: string }[];
}

export interface DraftScriptResult {
  beats: { index: number; text: string }[];
}

export interface RefineResult {
  text: string;
}

export interface CaptionCoverResult {
  caption: string;
  hashtags: string;
  covers: CoverOption[];
}

export interface CoverOption {
  id: string;
  label: string;
  big: string;
  small: string;
  bg?: string;
  fg?: string;
  accent?: string;
}
