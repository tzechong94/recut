// The persisted drama document. Project → SeriesBible + Scenes → Shots → Takes.
// Entities are REFERENCED by shots, never copied. The Shot is the unit of work; the
// Take is the unit of iteration (many takes, one accepted).

import type { AssetRef, CompiledPrompt, Capability, ProviderPayload } from '../gateway/types';

export type EntityKind = 'character' | 'prop' | 'location' | 'vehicle';

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  /** stable registry slug used verbatim in prompts (spec 1.1): `hero`, `hero_wet` */
  slug?: string;
  /** state variant (spec 1.8): this entity is `variantOf` another, in state `state` */
  variantOf?: string;
  state?: string;
  description: string;
  /** 1–5 locked reference images; the spike showed one is usually enough */
  refs: AssetRef[];
  /** VL-extracted, user-editable attribute block (hair, wardrobe, …) */
  attributes: Record<string, string>;
  /** bible version at which this entity last changed; drives the stale flag */
  version?: number;
}

export interface SeriesBible {
  version: number;
  entities: Entity[];
}

/** Typed control-surface state emitted by the camera rig (Sprint 2 adds the 3D UI). */
export interface CameraRigState {
  azimuthDeg: number;
  elevationDeg: number;
  distanceM: number;
  rollDeg: number;
  focalMm: number;
  aperture: number;
  subjectHeightM: number;
  move: NonNullable<CompiledPrompt['camera']['move']>;
}

export interface Light {
  role: 'key' | 'fill' | 'rim';
  azimuthDeg: number;
  elevationDeg: number;
  intensity: number;
  kelvin: number;
  hardness: 'hard' | 'soft';
}

export interface LightRigState {
  lights: Light[];
}

export interface Shot {
  id: string;
  sceneId: string;
  /** the story beat / action for this shot */
  action: string;
  /** entities referenced by this shot (refs injected at compile time) */
  entityIds: string[];
  camera: CameraRigState;
  light: LightRigState;
  takeIds: string[];
  acceptedTakeId?: string;
}

export interface Scene {
  id: string;
  title: string;
  shotIds: string[];
  /** scoped style override (spec Stage 2): replaces the project stylePrefix for this scene only */
  styleOverride?: string;
}

/** Every asset carries this. Non-negotiable (hard rule 7). */
export interface Provenance {
  modelId: string;
  capability: Capability;
  seed: number | null;
  compiledPrompt: CompiledPrompt;
  serializedPayload: ProviderPayload;
  params: Record<string, unknown>;
  latencyMs: number;
  costUsd: number;
  cacheHash: string;
  /** bible version this take compiled against — drives the stale flag (Sprint 4) */
  bibleVersion: number;
}

export interface Take {
  id: string;
  shotId: string;
  /** the produced asset (image url / data ref) */
  assetUrl: string;
  provenance: Provenance;
  accepted: boolean;
  /** VLM judge output for this take (spec Stage 3) */
  score?: number;
  verdict?: Record<string, unknown>;
}

export interface Project {
  id: string;
  title: string;
  /** global Style Prefix (spec Stage 2): default style glued to every compiled prompt */
  stylePrefix?: string;
  bible: SeriesBible;
  scenes: Scene[];
  shots: Shot[];
  takes: Take[];
}
