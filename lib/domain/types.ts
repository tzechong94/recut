// The persisted drama document. Project → SeriesBible + Scenes → Shots → Takes.
// Entities are REFERENCED by shots, never copied. The Shot is the unit of work; the
// Take is the unit of iteration (many takes, one accepted).

import type { AssetRef, CompiledPrompt, Capability, ProviderPayload } from '../gateway/types';

export type EntityKind = 'character' | 'prop' | 'location' | 'vehicle';

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
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
}

export interface Project {
  id: string;
  title: string;
  bible: SeriesBible;
  scenes: Scene[];
  shots: Shot[];
  takes: Take[];
}
