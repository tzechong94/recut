// The ONLY place the model-id string 'qwen3-max' may appear (hard rule 1). Confirmed live.
// The showrunner planner (text.plan): premise → structured story plan.

import type { ModelManifest } from '../lib/gateway/types';

export const QWEN_MAX: ModelManifest = {
  id: 'qwen3-max',
  provider: 'dashscope',
  capability: 'text.plan',
  region: 'ap-southeast-1',
  supports: { resolutions: [] },
  cost: { unit: 'token', amount: 0.01 },
  latencyP50Sec: 8,
  serializer: () => ({}),
};

export const PLAN_MODEL_ID = QWEN_MAX.id;
