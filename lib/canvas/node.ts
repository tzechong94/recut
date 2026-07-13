// Canvas node state. A node holds a typed CompiledPrompt, NEVER a prompt string. This is the
// thing TapNow gets wrong: their prompts are strings, so switching the model degrades them.
// Ours recompiles/reserializes from the CompiledPrompt, so switching models is lossless.

import type { Capability, CompiledPrompt, ModelManifest, ProviderPayload } from '../gateway/types';

export type NodeStatus = 'idle' | 'running' | 'cached' | 'stale' | 'failed' | 'accepted';

export interface CanvasNodeState {
  id: string;
  capability: Capability;
  compiledPrompt: CompiledPrompt;
  modelId: string;
  payload: ProviderPayload;
  status: NodeStatus;
  estCostUsd: number;
}

/**
 * Switch the model backing a node. The CompiledPrompt is preserved byte-for-byte; only the
 * serialized payload, model id, and cost estimate change. Asserted in a test.
 */
export function switchModel(node: CanvasNodeState, manifest: ModelManifest): CanvasNodeState {
  if (manifest.capability !== node.capability) {
    throw new Error(`manifest ${manifest.id} is ${manifest.capability}, node needs ${node.capability}`);
  }
  return {
    ...node,
    modelId: manifest.id,
    payload: manifest.serializer(node.compiledPrompt), // recompiled from the typed prompt
    estCostUsd: manifest.cost.amount,
    status: 'idle', // must re-run to produce a take under the new model
  };
}

/** Typed ports: an image output cannot feed an audio input, etc. Refuse invalid links. */
const OUTPUT_KIND: Record<Capability, 'image' | 'video' | 'audio' | 'text'> = {
  'text.plan': 'text',
  'image.generate': 'image',
  'image.edit': 'image',
  'video.t2v': 'video',
  'video.i2v': 'video',
  'video.r2v': 'video',
  'video.edit': 'video',
  'video.animate': 'video',
  'audio.tts': 'audio',
  'audio.asr': 'text',
  'vision.critique': 'text',
};

const INPUT_KINDS: Record<Capability, Array<'image' | 'video' | 'audio' | 'text'>> = {
  'text.plan': ['text'],
  'image.generate': ['text'],
  'image.edit': ['image', 'text'],
  'video.t2v': ['text'],
  'video.i2v': ['image', 'text'],
  'video.r2v': ['image', 'text'],
  'video.edit': ['video', 'text'],
  'video.animate': ['image', 'video'],
  'audio.tts': ['text'],
  'audio.asr': ['audio'],
  'vision.critique': ['image', 'video'],
};

export interface PortCheck {
  ok: boolean;
  reason?: string;
}

/** Can the output of `from` connect to the input of `to`? Reason is shown at drag time. */
export function canConnect(from: Capability, to: Capability): PortCheck {
  const outKind = OUTPUT_KIND[from];
  const accepted = INPUT_KINDS[to];
  if (accepted.includes(outKind)) return { ok: true };
  return { ok: false, reason: `${outKind} output cannot feed a ${to} node (accepts ${accepted.join('/')})` };
}
