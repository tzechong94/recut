// The ONLY place the model-id string 'qwen-image-edit' may appear (hard rule 1).
// Confirmed live on the intl key (ap-southeast-1); the identity spike validated it as the
// image.edit path (the plan's qwen-image-2.0-pro is absent — see docs/BLOCKED.md).

import type { ModelManifest } from '../lib/gateway/types.js';
import { serializeImageEdit } from '../serializers/dashscope.js';

export const qwenImageEdit: ModelManifest = {
  id: 'qwen-image-edit',
  provider: 'dashscope',
  capability: 'image.edit',
  region: 'ap-southeast-1',
  supports: {
    maskInpaint: false,
    bboxEdit: false,
    maxRefImages: 3,
    maxOutputs: 1,
    negativePrompt: true,
    seed: true,
    resolutions: ['1024*1024', '720*1280', '1280*720'],
  },
  cost: { unit: 'image', amount: 0.05 },
  latencyP50Sec: 12,
  serializer: serializeImageEdit,
};
