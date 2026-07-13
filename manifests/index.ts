// Manifest registry. Adding a provider = adding one file here + one serializer, with zero
// changes elsewhere (proven by the Kling stub in Sprint 3).

import type { ModelManifest } from '../lib/gateway/types.js';
import { qwenImageEdit } from './qwen-image-edit.js';
import { qwenImagePlus } from './qwen-image-plus.js';

export const MANIFESTS: ModelManifest[] = [qwenImageEdit, qwenImagePlus];

export function manifestById(id: string): ModelManifest | undefined {
  return MANIFESTS.find((m) => m.id === id);
}
