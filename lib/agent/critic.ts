// The continuity critic — the differentiator. qwen3-vl-plus judges a take against the bible's
// locked references and the shot's intent, returns a schema-constrained verdict, and never
// fake-passes: a parse failure hard-fails to verdict "unknown" with zero scores, not 1.0.

import { Gateway } from '../gateway/jobs';
import { CRITIC_MODEL_ID } from '../../manifests/qwen-vl-critic';

export interface ContinuityVerdict {
  identity_match: number;
  wardrobe_match: number;
  prop_match: number;
  location_match: number;
  palette_match: number;
  framing_match: number;
  artifacts: string[];
  verdict: 'pass' | 'repair' | 'reject' | 'unknown';
  repair_instruction: string;
}

const AXES = ['identity_match', 'wardrobe_match', 'prop_match', 'location_match', 'palette_match', 'framing_match'] as const;

// Weighted composite → the Continuity Score. Identity dominates; framing and wardrobe next.
const WEIGHTS: Record<(typeof AXES)[number], number> = {
  identity_match: 0.35,
  wardrobe_match: 0.2,
  framing_match: 0.15,
  prop_match: 0.1,
  location_match: 0.1,
  palette_match: 0.1,
};

export const CONTINUITY_THRESHOLD = 0.7;

export function continuityScore(v: ContinuityVerdict): number {
  return Number(AXES.reduce((sum, a) => sum + WEIGHTS[a] * clamp01(v[a]), 0).toFixed(3));
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/** Hard-fail verdict — never a fake pass. Used when the model output can't be parsed. */
export function unknownVerdict(reason: string): ContinuityVerdict {
  return {
    identity_match: 0, wardrobe_match: 0, prop_match: 0, location_match: 0, palette_match: 0, framing_match: 0,
    artifacts: [reason], verdict: 'unknown', repair_instruction: '',
  };
}

export function critiquePrompt(intent: string): string {
  return (
    `You are a film continuity supervisor. Image 1..N are the LOCKED reference(s) for the ` +
    `character/props/location. The FINAL image is a generated take meant to depict: "${intent}". ` +
    `Judge how well the take matches the locked references and intent. Return STRICT JSON:\n` +
    `{"identity_match":0..1,"wardrobe_match":0..1,"prop_match":0..1,"location_match":0..1,` +
    `"palette_match":0..1,"framing_match":0..1,"artifacts":[strings],"verdict":"pass|repair|reject",` +
    `"repair_instruction":"specific correction naming the drift, e.g. 'the scarf is blue; it must be red. ` +
    `Preserve pose and lighting.'"}. Use 1.0 only for a perfect match. If an axis is not applicable ` +
    `(no prop/location in the reference), score it 1.0. JSON only.`
  );
}

export function buildCritiquePayload(takeUrl: string, refUrls: string[], intent: string): Record<string, unknown> {
  return {
    messages: [
      {
        role: 'user',
        content: [...refUrls.map((u) => ({ image: u })), { image: takeUrl }, { text: critiquePrompt(intent) }],
      },
    ],
  };
}

export function parseVerdict(text: string): ContinuityVerdict {
  try {
    const t = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const d = JSON.parse(t) as Partial<ContinuityVerdict>;
    const num = (v: unknown) => clamp01(Number(v ?? 0));
    return {
      identity_match: num(d.identity_match),
      wardrobe_match: num(d.wardrobe_match),
      prop_match: num(d.prop_match),
      location_match: num(d.location_match),
      palette_match: num(d.palette_match),
      framing_match: num(d.framing_match),
      artifacts: Array.isArray(d.artifacts) ? d.artifacts.map(String) : [],
      verdict: d.verdict === 'pass' || d.verdict === 'repair' || d.verdict === 'reject' ? d.verdict : 'unknown',
      repair_instruction: typeof d.repair_instruction === 'string' ? d.repair_instruction : '',
    };
  } catch {
    return unknownVerdict('critic output not parseable');
  }
}

export interface CritiqueResult {
  verdict: ContinuityVerdict;
  score: number;
  cached: boolean;
}

/**
 * Critique a take. Cached by content hash through the Gateway (replay = free, deterministic).
 * `vlFn` performs the live VL call and returns raw text; only invoked in live mode.
 */
export async function critique(
  takeUrl: string,
  refUrls: string[],
  intent: string,
  opts: { gateway?: Gateway; vlFn?: (payload: Record<string, unknown>) => Promise<string> } = {},
): Promise<CritiqueResult> {
  const gateway = opts.gateway ?? new Gateway();
  const payload = buildCritiquePayload(takeUrl, refUrls, intent);
  const result = await gateway.run<ContinuityVerdict>({
    modelId: CRITIC_MODEL_ID,
    serializedPayload: payload,
    seed: 0,
    costUsd: 0.005,
    live: async () => {
      if (!opts.vlFn) throw new Error('live critique requires vlFn');
      return parseVerdict(await opts.vlFn(payload));
    },
  });
  return { verdict: result.payload, score: continuityScore(result.payload), cached: true };
}
