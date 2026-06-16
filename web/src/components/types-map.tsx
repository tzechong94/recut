import { Film, Image as ImageIcon, Sparkles, Type } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SlotType } from "../types";

export interface TypeMeta {
  label: string;
  actor: "you" | "auto";
  hint: string;
  color: string;
  soft: string;
  Icon: LucideIcon;
}

/** v1 slot types only (text, talk, roll, broll) — face/illus gated off. */
export const TYPES: Record<SlotType, TypeMeta> = {
  text: {
    label: "Text card",
    actor: "auto",
    hint: "Auto-built",
    color: "#64748B",
    soft: "#EEF1F5",
    Icon: Type,
  },
  talk: {
    label: "Talking head",
    actor: "you",
    hint: "Film this",
    color: "#FF5C49",
    soft: "#FFEDEA",
    Icon: Film,
  },
  roll: {
    label: "Camera roll",
    actor: "you",
    hint: "Pick a clip",
    color: "#0FB5A6",
    soft: "#E1F6F3",
    Icon: ImageIcon,
  },
  broll: {
    label: "Generated b-roll",
    actor: "auto",
    hint: "Auto-generated",
    color: "#7B5CFF",
    soft: "#F0ECFF",
    Icon: Sparkles,
  },
};

export const FONTS = {
  display: "Bricolage Grotesque",
  clean: "DM Sans",
  mono: "JetBrains Mono",
} as const;

export const STAGES = [
  "Reference",
  "Recipe",
  "Script",
  "Storyboard",
  "Cover",
] as const;

/** Darken a hex color for gradients (matches prototype's shade()). */
export function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (n >> 16) - 46);
  const g = Math.max(0, ((n >> 8) & 255) - 46);
  const b = Math.max(0, (n & 255) - 46);
  return `rgb(${r},${g},${b})`;
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
