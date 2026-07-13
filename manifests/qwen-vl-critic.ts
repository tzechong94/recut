// The ONLY place the model-id string 'qwen3-vl-plus' may appear (hard rule 1). Confirmed live
// on the intl key. Used as the continuity critic (vision.critique). Its serializer is unused
// (critique builds its own multi-image payload); provided to satisfy the manifest shape.

import type { ModelManifest } from '../lib/gateway/types';

export const VISION_CRITIC: ModelManifest = {
  id: 'qwen3-vl-plus',
  provider: 'dashscope',
  capability: 'vision.critique',
  region: 'ap-southeast-1',
  supports: { maxRefImages: 5, resolutions: [] },
  cost: { unit: 'token', amount: 0.005 },
  latencyP50Sec: 6,
  serializer: () => ({}),
};

export const CRITIC_MODEL_ID = VISION_CRITIC.id;
