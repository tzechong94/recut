/**
 * Take helpers — the client side of the fidelity contract.
 * Staleness mirrors backend take_is_stale; rates mirror the router's take_rate.
 */
import type { Pricing, Shot, Take } from "../types";

/** Mirror of backend still_signature (keep in sync with production.py). */
export function stillSignature(sh: Shot): string {
  return [
    sh.action.trim(),
    sh.shot_type,
    [...sh.character_ids].sort().join(","),
    sh.location_id || "",
  ].join("|");
}

/** A stale take was filmed from a still/line the shot no longer has. */
export function takeIsStale(shot: Shot, take: Take): boolean {
  if (take.keyframe_asset_id && shot.keyframe_asset_id && take.keyframe_asset_id !== shot.keyframe_asset_id) return true;
  if (take.keyframe_sig && take.keyframe_sig !== stillSignature(shot)) return true;
  return false; // caption_hash needs the backend's hash — sig+still cover the visual cases
}

/** $/second for a take's model (mirrors the backend's take_rate). */
export function takeRate(model: string | null | undefined, pricing: Pricing | null): number | null {
  if (!pricing) return null;
  if (!model) return pricing.video_second_final;
  if (model.startsWith("happyhorse") || model.startsWith("wan2.5") || model.startsWith("wan2.6")) {
    return pricing.video_second_happyhorse ?? pricing.video_second_final;
  }
  if (model.includes("flash")) return pricing.video_second_draft;
  return pricing.video_second_final;
}

export function takeCostUsd(take: Take, pricing: Pricing | null): number | null {
  const r = takeRate(take.model, pricing);
  return r == null ? null : take.duration_s * r;
}

/** Short display label for a take's model. */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return "legacy";
  if (model.startsWith("wan2.6")) return model.includes("1080") ? "wan2.6 · master" : "wan2.6 · speaks";
  if (model.startsWith("happyhorse")) return "happyhorse";
  if (model.includes("flash")) return "wan flash · draft";
  if (model.includes("plus")) return "wan plus";
  return model;
}
