// PROOF-OF-ABSTRACTION stub. A manifest for a provider that does not exist yet. It is NOT
// in the default MANIFESTS registry (the "disabled flag"); a test adds it to a pool and shows
// selectModel routes to it with ZERO changes to router.ts or anything outside these two files
// (this manifest + serializers/kling.ts). If wiring it required touching anything else, the
// abstraction would be wrong.
//
// Do NOT add a non-Qwen provider to the live registry before 21 July (see docs "Do not").

import type { ModelManifest } from '../lib/gateway/types';
import { serializeKlingT2V } from '../serializers/kling';

export const EXAMPLE_KLING: ModelManifest = {
  id: 'kling-v1',
  provider: 'kling',
  capability: 'video.t2v',
  region: 'ap-southeast-1',
  supports: {
    negativePrompt: true,
    seed: true,
    resolutions: ['720P', '1080P'],
    durationRange: [5, 10],
  },
  cost: { unit: 'second', amount: 0.1 },
  latencyP50Sec: 90,
  serializer: serializeKlingT2V,
};
