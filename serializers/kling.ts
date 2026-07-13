// STUB serializer for a provider that does not exist yet (Kling). Proves the abstraction:
// adding a provider is one manifest file + one serializer, with zero changes elsewhere.
// After the hackathon this becomes a real CompiledPrompt → Kling dialect mapping.

import type { CompiledPrompt, ProviderPayload } from '../lib/gateway/types';
import { promptSentence } from './dashscope';

export function serializeKlingT2V(p: CompiledPrompt): ProviderPayload {
  return {
    prompt: promptSentence(p),
    negative_prompt: p.negative,
    aspect_ratio: '9:16',
    ...(p.seed !== undefined ? { seed: p.seed } : {}),
  };
}
