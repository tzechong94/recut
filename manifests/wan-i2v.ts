// The ONLY place the model-id string 'wan2.6-i2v' may appear (hard rule 1). Confirmed live on
// the intl key: image-to-video from a first frame (img_url), native-audio capable, duration
// 3-15s. (wan2.7-i2v wants a different `media` shape; wan2.2 has a fixed duration.)

import type { ModelManifest } from '../lib/gateway/types';

export const WAN_I2V: ModelManifest = {
  id: 'wan2.6-i2v',
  provider: 'dashscope',
  capability: 'video.i2v',
  region: 'ap-southeast-1',
  supports: {
    firstFrame: true,
    nativeAudio: true,
    seed: true,
    durationRange: [3, 15],
    resolutions: ['720P', '1080P'],
  },
  cost: { unit: 'second', amount: 0.1 },
  latencyP50Sec: 75,
  serializer: () => ({}),
};

export const I2V_MODEL_ID = WAN_I2V.id;
