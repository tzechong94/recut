// The ONLY place the model-id string 'qwen3-tts-flash' may appear (hard rule 1). Confirmed live:
// input {text, voice} → output.audio.url (.wav). Voices: Cherry / Serena / Ethan / Chelsie.

import type { ModelManifest } from '../lib/gateway/types';

export const QWEN_TTS: ModelManifest = {
  id: 'qwen3-tts-flash',
  provider: 'dashscope',
  capability: 'audio.tts',
  region: 'ap-southeast-1',
  supports: { resolutions: [] },
  cost: { unit: 'token', amount: 0.002 },
  latencyP50Sec: 3,
  serializer: () => ({}),
};

export const TTS_MODEL_ID = QWEN_TTS.id;
export const TTS_VOICES = ['Cherry', 'Serena', 'Ethan', 'Chelsie'] as const;
