/**
 * Test/dev fixtures mirroring the backend's compiled render Timeline and the
 * Showrunner domain. Kept tiny and dependency-free.
 */
import type {
  Production,
  ProductionEval,
  Scoreboard,
  Slot,
  Timeline,
} from "../types";

export function makeSlot(over: Partial<Slot> = {}): Slot {
  return {
    id: "shot_1",
    beat_label: "Shot 1",
    type: "broll",
    duration_s: 3,
    source: "standin",
    asset_id: null,
    text: "A detective lights a cigarette in the rain.",
    text_role: "on_screen_text",
    style: { font: "display", size: "l", align: "center" },
    status: "ready",
    kept: true,
    ...over,
  };
}

export function makeTimeline(slots?: Slot[]): Timeline {
  return {
    timeline_id: "tl_prod_1",
    project_id: "proj_1",
    version: 1,
    aspect_ratio: "9:16",
    fps: 30,
    audio: {
      voiceover: { asset_id: null, enabled: false },
      bed: { asset_id: null, enabled: false },
    },
    music_sync: null,
    slots: slots ?? [
      makeSlot({ id: "s1", beat_label: "Shot 1", text: "Opening hook", duration_s: 3 }),
      makeSlot({
        id: "s2",
        beat_label: "Shot 2",
        text: "The turn",
        duration_s: 4,
        style: { font: "clean", size: "m", align: "center" },
      }),
      makeSlot({
        id: "s3",
        beat_label: "Shot 3",
        text: "The payoff",
        duration_s: 3,
        style: { font: "clean", size: "m", align: "center" },
      }),
    ],
  };
}

export function makeScoreboard(over: Partial<Scoreboard> = {}): Scoreboard {
  return {
    tokens: { text: 4000, image: 6000, video: 120000, voice: 3000, total: 133000 },
    rerolls: 2,
    naive_baseline_tokens: 400000,
    tokens_saved: 267000,
    savings_pct: 66.8,
    shots_ready: 3,
    shots_total: 6,
    avg_consistency: 0.91,
    duration_s: 42,
    ...over,
  };
}

export function makeProduction(over: Partial<Production> = {}): Production {
  return {
    id: "prod_1",
    project_id: "proj_1",
    premise: "A burnt-out detective gets one last case.",
    logline: "One last case before the rain washes it all away.",
    title: "The Last Case",
    dramatic_question: "Will Vance solve the case before it solves him?",
    theme: "redemption",
    target_seconds: 60,
    stage: "production",
    style: {
      name: "noir",
      descriptors: "film noir, high-contrast black and white",
      palette: "monochrome",
      locked: true,
    },
    characters: [
      {
        id: "char_1",
        name: "Detective Vance",
        description: "Worn trench coat, tired eyes.",
        role: "protagonist",
        reference_asset_id: null,
        reference_url: null,
        source: "none",
        locked: false,
        voice: "longxiaochun_v2",
      },
    ],
    locations: [
      {
        id: "loc_1",
        name: "Rain-soaked alley",
        description: "Neon reflections on wet asphalt.",
        reference_asset_id: null,
        reference_url: null,
        source: "none",
        locked: false,
      },
    ],
    scenes: [
      {
        id: "scene_1",
        index: 0,
        heading: "EXT. ALLEY - NIGHT",
        summary: "Vance finds the clue.",
        script: [
          {
            character_id: "char_1",
            character_name: "Detective Vance",
            line: "Some cases don't want to be solved.",
          },
          {
            character_id: "char_1",
            character_name: "Detective Vance",
            line: "But this one's personal.",
          },
        ],
        shots: [
          {
            id: "shot_1",
            index: 0,
            shot_type: "wide",
            camera: "static",
            action: "Vance steps into the alley.",
            dialogue: [],
            narration: "It always rains on the worst nights.",
            character_ids: ["char_1"],
            location_id: "loc_1",
            duration_s: 4,
            source: "standin",
            asset_id: null,
            status: "planned",
            gen_tool: "i2v",
            reroll_count: 0,
            critic_score: null,
          },
        ],
      },
    ],
    token_ledger: {
      text_tokens: 4000,
      image_tokens: 6000,
      video_tokens: 120000,
      voice_tokens: 3000,
      rerolls: 2,
    },
    writers_room: [
      { role: "writer", text: "The Last Case — One last case before the rain." },
      { role: "critic", text: "Raise the stakes in act two.", score: 0.7 },
      { role: "writer", text: "Revised per notes: sharper midpoint turn." },
      { role: "critic", text: "Stronger. Tighten the ending beat.", score: 0.86 },
      { role: "writer", text: "Final pass: the rain becomes the reckoning." },
      {
        role: "dialogue",
        text: "Some cases don't want to be solved. But this one's personal.",
        score: 0.82,
      },
    ],
    director_log: [
      {
        shot: "Shot 1",
        decision: "image-to-video from locked reference",
        reason: "consistency 0.94; clean on first pass",
      },
      {
        shot: "Shot 2",
        decision: "re-rolled image-to-video",
        reason: "consistency 0.71 → 0.88; fixed wardrobe drift",
      },
    ],
    warnings: [
      "Scene 4 dropped to hit the 60s target.",
      "Dialogue pass retried once after a parse hiccup.",
    ],
    version: 1,
    ...over,
  };
}

export function makeEval(over: Partial<ProductionEval> = {}): ProductionEval {
  return {
    narrative: {
      overall: 0.88,
      scores: {
        premise_clarity: 0.92,
        character: 0.85,
        stakes: 0.83,
        payoff: 0.9,
      },
      notes: "Clear dramatic question; the midpoint turn lands and the ending pays it off.",
    },
    tokens: {
      total: 133000,
      video_tokens: 120000,
      video_tokens_pre_approval: 0,
      rerolls: 2,
      baseline_estimate: 400000,
      estimated_saved: 267000,
    },
    avg_consistency: 0.91,
    ...over,
  };
}
