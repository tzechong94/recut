// The ONLY place the model-id string 'wan2.7-r2v' may appear (hard rule 1). Confirmed live on
// the intl key (2026-07-11 shakedown): reference-to-video with `media:[{type:"reference_image",
// url}]` on the legacy video-synthesis endpoint. Refs must be hosted urls (not data URIs).

import type { ModelManifest } from '../lib/gateway/types';

export const WAN_R2V: ModelManifest = {
  id: 'wan2.7-r2v',
  provider: 'dashscope',
  capability: 'video.r2v',
  region: 'ap-southeast-1',
  supports: {
    maxRefImages: 4,
    nativeAudio: true,
    seed: true,
    durationRange: [3, 15],
    resolutions: ['720P', '1080P'],
  },
  cost: { unit: 'second', amount: 0.12 },
  latencyP50Sec: 90,
  serializer: () => ({}),
};

export const R2V_MODEL_ID = WAN_R2V.id;
