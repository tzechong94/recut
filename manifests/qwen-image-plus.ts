// The ONLY place the model-id string 'qwen-image-plus' may appear (hard rule 1).
// Confirmed live on the intl key; used to generate the canonical entity portrait (t2i).

import type { ModelManifest } from '../lib/gateway/types.js';
import { serializeImageGenerate } from '../serializers/dashscope.js';

export const qwenImagePlus: ModelManifest = {
  id: 'qwen-image-plus',
  provider: 'dashscope',
  capability: 'image.generate',
  region: 'ap-southeast-1',
  supports: {
    maxOutputs: 1,
    negativePrompt: true,
    seed: true,
    resolutions: ['1024*1024', '720*1280', '1280*720'],
  },
  cost: { unit: 'image', amount: 0.05 },
  latencyP50Sec: 10,
  serializer: serializeImageGenerate,
};
