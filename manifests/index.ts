// Manifest registry. Adding a provider = adding one file here + one serializer, with zero
// changes elsewhere (proven by the Kling stub in Sprint 3).

import type { ModelManifest } from '../lib/gateway/types';
import { qwenImageEdit } from './qwen-image-edit';
import { qwenImagePlus } from './qwen-image-plus';

export const MANIFESTS: ModelManifest[] = [qwenImageEdit, qwenImagePlus];

export function manifestById(id: string): ModelManifest | undefined {
  return MANIFESTS.find((m) => m.id === id);
}
