// Manifest registry. Adding a provider = adding one file here + one serializer, with zero
// changes elsewhere (proven by the Kling stub in Sprint 3).

import type { ModelManifest } from '../lib/gateway/types';
import { QWEN_MAX } from './qwen-max';
import { qwenImageEdit } from './qwen-image-edit';
import { qwenImagePlus } from './qwen-image-plus';
import { WAN_I2V } from './wan-i2v';
import { WAN_R2V } from './wan-r2v';
import { VISION_CRITIC } from './qwen-vl-critic';
import { QWEN_TTS } from './qwen-tts';

export const MANIFESTS: ModelManifest[] = [QWEN_MAX, qwenImageEdit, qwenImagePlus, WAN_I2V, WAN_R2V, VISION_CRITIC, QWEN_TTS];

export function manifestById(id: string): ModelManifest | undefined {
  return MANIFESTS.find((m) => m.id === id);
}
