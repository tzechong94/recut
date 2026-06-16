/**
 * Offline fallback data. Every not-yet-built endpoint (analyse / cowrite /
 * draft-script / refine / caption-cover / base-cut) degrades to these so the
 * whole UI is demoable without a backend. Shapes match the real schemas.
 */
import type {
  CaptionCoverResult,
  CoverOption,
  Recipe,
  Slot,
  SlotType,
  Timeline,
  TokenLedger,
} from "../types";

let counter = 0;
export function localId(prefix = "x"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

/* ----------------------------- Demo recipe ----------------------------- */
export const DEMO_RECIPE: Recipe = {
  recipe_id: "demo-recipe",
  name: "Sourcing haul → big reveal",
  duration_s: 22,
  shot_count: 7,
  aspect_ratio: "9:16",
  hook_transcript: "Wait till you see what this actually cost…",
  observations: [
    "Hook-first. A 3-second bold-text claim before anything else.",
    "Proof in the middle. Three quick cuts carry the evidence.",
    "Payoff to camera. The reveal lands on a talking head.",
    "Captions burned in, punchy and lower-third.",
  ],
  analysis_meta: {
    plays: "412k",
    cuts: 7,
    pacing: "fast-cut",
    audio_transcribed: true,
    on_screen_text_read: true,
  },
  beats: [
    {
      index: 0,
      label: "Hook",
      slot_type: "text",
      start_s: 0,
      duration_s: 3,
      pattern: "bold-claim",
      text_role: "on_screen_text",
      transcript_excerpt: "",
      on_screen_text: "I saved 60% on marble. Here's how.",
      style_hint: "display l center",
    },
    {
      index: 1,
      label: "Setup",
      slot_type: "talk",
      start_s: 3,
      duration_s: 4,
      pattern: "to-camera",
      text_role: "voiceover",
      transcript_excerpt: "Everyone overpays for stone.",
      on_screen_text: "Everyone overpays for stone. So I went straight to the source.",
      style_hint: "clean m left",
    },
    {
      index: 2,
      label: "Cut 1",
      slot_type: "roll",
      start_s: 7,
      duration_s: 3,
      pattern: "establishing",
      text_role: "voiceover",
      transcript_excerpt: "",
      on_screen_text: "Walking onto the Foshan factory floor",
      style_hint: "clean m left",
    },
    {
      index: 3,
      label: "Cut 2",
      slot_type: "broll",
      start_s: 10,
      duration_s: 3,
      pattern: "detail",
      text_role: "voiceover",
      transcript_excerpt: "",
      on_screen_text: "Slabs on the saw line — sparks, the scale of the warehouse",
      style_hint: "clean m left",
    },
    {
      index: 4,
      label: "Cut 3",
      slot_type: "roll",
      start_s: 13,
      duration_s: 2,
      pattern: "detail",
      text_role: "voiceover",
      transcript_excerpt: "",
      on_screen_text: "Close-up — hand across the polished slab",
      style_hint: "clean m left",
    },
    {
      index: 5,
      label: "Payoff",
      slot_type: "talk",
      start_s: 15,
      duration_s: 5,
      pattern: "reveal",
      text_role: "voiceover",
      transcript_excerpt: "Same slab. Sixty percent less.",
      on_screen_text: "Same slab. Sixty percent less. No middleman.",
      style_hint: "clean m left",
    },
    {
      index: 6,
      label: "CTA",
      slot_type: "text",
      start_s: 20,
      duration_s: 2,
      pattern: "cta",
      text_role: "on_screen_text",
      transcript_excerpt: "",
      on_screen_text: "Follow for the supplier list →",
      style_hint: "display m center",
    },
  ],
};

/* stand-in tint per slot type, mirrors the prototype's TYPES colors. */
export const STANDIN_COLOR: Record<SlotType, string> = {
  text: "#64748B",
  talk: "#FF5C49",
  roll: "#0FB5A6",
  broll: "#7B5CFF",
};

const STANDIN_LABEL: Record<SlotType, string> = {
  text: "text card",
  talk: "talking head",
  roll: "camera roll",
  broll: "generated b-roll",
};

function parseStyleHint(hint: string): Slot["style"] {
  const parts = hint.split(/\s+/);
  const font = (["display", "clean", "mono"].find((f) => parts.includes(f)) ??
    "clean") as Slot["style"]["font"];
  const size = (["s", "m", "l"].find((s) => parts.includes(s)) ??
    "m") as Slot["style"]["size"];
  const align = (["left", "center", "right"].find((a) => parts.includes(a)) ??
    "left") as Slot["style"]["align"];
  return { font, size, align };
}

/** Build a client-side base-cut Timeline from a Recipe (all stand-ins). */
export function demoBaseCut(projectId: string, recipe: Recipe): Timeline {
  const slots: Slot[] = recipe.beats.map((b) => ({
    id: localId("slot"),
    beat_label: b.label,
    type: b.slot_type,
    order: b.index,
    duration_s: b.duration_s,
    source: "standin",
    asset_id: null,
    standin: {
      kind: b.slot_type,
      color: STANDIN_COLOR[b.slot_type],
      label: STANDIN_LABEL[b.slot_type],
    },
    text: b.on_screen_text,
    text_role: b.text_role,
    style: parseStyleHint(b.style_hint),
    status: "ready",
    generation: null,
    kept: b.slot_type === "broll",
  }));
  return {
    timeline_id: localId("tl"),
    project_id: projectId,
    version: 1,
    aspect_ratio: "9:16",
    fps: recipe.aspect_ratio ? 30 : 30,
    audio: {
      voiceover: { asset_id: null, enabled: false },
      bed: { asset_id: null, enabled: false, gain_db: -18 },
    },
    slots,
    token_ledger: recomputeLedger(slots),
    music_sync: null,
  };
}

/**
 * Local ledger recompute (the real server recomputes on PUT; this keeps the
 * provenance panel honest while offline). Tokens are a simple per-second proxy:
 * generated footage costs tokens, the naive baseline generates the whole video.
 */
const TOKENS_PER_GENERATED_S = 1200;
export function recomputeLedger(slots: Slot[]): TokenLedger {
  let real = 0;
  let generated = 0;
  let standin = 0;
  for (const s of slots) {
    if (s.source === "user_upload") real += s.duration_s;
    else if (s.source === "generated") generated += s.duration_s;
    else standin += s.duration_s;
  }
  const total = real + generated + standin;
  return {
    real_footage_s: round1(real),
    generated_s: round1(generated),
    standin_s: round1(standin),
    tokens_spent: Math.round(generated * TOKENS_PER_GENERATED_S),
    naive_baseline_tokens: Math.round(total * TOKENS_PER_GENERATED_S),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/* --------------------------- Co-writing thread --------------------------- */
export const DEMO_THREAD: { who: "agent" | "you"; text: string }[] = [
  {
    who: "agent",
    text: "Tell me everything about this post — what's the story, what surprised you, and what do you want people to feel by the end?",
  },
  {
    who: "you",
    text: "I flew to Foshan and bought marble straight from the factory. Same slabs the showrooms sell, about 60% cheaper. I want people to feel like they've been overpaying.",
  },
  {
    who: "agent",
    text: "Love it — that gap between showroom price and factory price is your whole hook. One thing: what's the single most striking visual from the trip?",
  },
  {
    who: "you",
    text: "The warehouse scale. Slabs stacked three storeys high, saws throwing sparks.",
  },
  {
    who: "agent",
    text: "Perfect. I'll open on the claim, use the warehouse for proof, and land the payoff to camera. Drafting it onto your seven beats now.",
  },
];

/* ---------------------------- Covers / caption ---------------------------- */
export const DEMO_COVERS: CoverOption[] = [
  {
    id: "claim",
    label: "Bold claim",
    bg: "#17151C",
    fg: "#FFFFFF",
    accent: "#FF5C49",
    big: "60% OFF",
    small: "MARBLE, DIRECT FROM THE FACTORY",
  },
  {
    id: "face",
    label: "Face + caption",
    bg: "#0FB5A6",
    fg: "#03251F",
    accent: "#03251F",
    big: "I went to\nthe source",
    small: "FOSHAN SOURCING TRIP",
  },
  {
    id: "split",
    label: "Before / after",
    bg: "#F5A524",
    fg: "#2A1B00",
    accent: "#2A1B00",
    big: "$$$ → $",
    small: "WHAT MIDDLEMEN DON'T TELL YOU",
  },
];

export const DEMO_CAPTION_COVER: CaptionCoverResult = {
  caption:
    "I stopped paying showroom prices for marble. Flew to Foshan and bought the same slabs straight from the factory — about 60% less. Here's exactly how 👇",
  hashtags:
    "#renovation #interiordesign #marble #sourcing #factorydirect #homereno #designtips",
  covers: DEMO_COVERS,
};

/* A small starter recipe library for offline browsing. */
export const DEMO_LIBRARY: Recipe[] = [
  { ...DEMO_RECIPE, recipe_id: "lib-haul", saved: true },
  {
    ...DEMO_RECIPE,
    recipe_id: "lib-mistakes",
    name: "5 mistakes listicle",
    hook_transcript: "Number 3 cost me $4,000…",
    duration_s: 28,
    shot_count: 6,
    saved: true,
    observations: [
      "Numbered countdown structure keeps retention high.",
      "Each mistake is one quick cut + a caption.",
      "Pay-off on the most expensive mistake.",
    ],
  },
  {
    ...DEMO_RECIPE,
    recipe_id: "lib-bts",
    name: "Build BTS time-lapse",
    hook_transcript: "Three weeks in ninety seconds…",
    duration_s: 18,
    shot_count: 5,
    saved: true,
    observations: [
      "Cold-open on the finished result, then rewind.",
      "Time-lapse b-roll between talking-head beats.",
      "Satisfying final reveal.",
    ],
  },
];
