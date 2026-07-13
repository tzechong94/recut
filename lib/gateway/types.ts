// Core gateway + compiler types. This is the spine every downstream layer reads.
// Model-id strings live ONLY in manifests/ — never here, never in components.

export type Capability =
  | 'text.plan'
  | 'image.generate'
  | 'image.edit'
  | 'video.t2v'
  | 'video.i2v'
  | 'video.r2v'
  | 'video.edit'
  | 'video.animate'
  | 'audio.tts'
  | 'audio.asr'
  | 'vision.critique';

export interface AssetRef {
  id: string;
  url: string;
  /** lower = more important; refs are ordered by importance for the model */
  weight: number;
  entityId?: string;
}

export interface CompiledPrompt {
  subject: { entityIds: string[]; description: string };
  action: string;
  camera: {
    shotSize: 'ECU' | 'CU' | 'MCU' | 'MS' | 'MLS' | 'WS' | 'EWS';
    angle: {
      elevation: 'low' | 'eye' | 'high' | 'overhead';
      azimuth: 'frontal' | 'three-quarter' | 'profile' | 'rear-three-quarter' | 'rear';
      degrees: [number, number];
    };
    lens: { focalMm: number; aperture: number; body?: string; character: string };
    dof: 'shallow' | 'medium' | 'deep';
    move?: 'static' | 'push-in' | 'pull-out' | 'pan' | 'tilt' | 'orbit' | 'handheld' | 'crane';
  };
  lighting: {
    setup: 'rembrandt' | 'split' | 'butterfly' | 'loop' | 'broad' | 'short' | 'practical' | 'natural';
    key: { azimuth: number; elevation: number; hardness: 'hard' | 'soft'; kelvin: number };
    fill?: { ratio: number };
    rim?: { azimuth: number; kelvin: number };
    mood: 'high-key' | 'low-key' | 'neutral';
  };
  palette: { name: string; hexes: string[] };
  style: string;
  negative: string;
  refs: AssetRef[];
  seed?: number;
}

/** Provider-native request body produced by a serializer. Opaque to the cache. */
export type ProviderPayload = Record<string, unknown>;

export interface ModelManifest {
  id: string;
  provider: 'dashscope' | 'kling' | 'runway' | 'openai';
  capability: Capability;
  region: string;
  supports: {
    nativeAudio?: boolean;
    firstFrame?: boolean;
    lastFrame?: boolean;
    continuation?: boolean;
    maskInpaint?: boolean;
    bboxEdit?: boolean;
    maxRefImages?: number;
    maxOutputs?: number;
    negativePrompt?: boolean;
    seed?: boolean;
    resolutions: string[];
    durationRange?: [number, number];
  };
  cost: { unit: 'image' | 'second' | 'token'; amount: number };
  latencyP50Sec: number;
  serializer: (p: CompiledPrompt) => ProviderPayload;
  polyfills?: Capability[];
}
