import { BudgetGovernor } from '../../../../lib/gateway/budget';
import { dashscopeText } from '../../../../adapters/dashscope-text';
import { PLAN_MODEL_ID, QWEN_MAX } from '../../../../manifests/qwen-max';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Turn a user's plain words ("warm cozy, like an apple ad") into a proper Style Prefix:
// medium, lighting, camera character, palette, realism rules. Never subjects or actions.
const SYSTEM =
  'You write global Style Prefixes for AI film generation (seedance-shotlist-director discipline). ' +
  'Given plain words from a user, expand them into ONE style prefix of 30-60 words: comma-separated phrases covering ' +
  'medium/finish (e.g. photorealistic commercial film, watercolor animation), lighting mood, camera/lens character, ' +
  'colour palette, and realism rules. NO subjects, NO actions, NO scene content, NO quotes. Return the prefix text only.';

export async function POST(req: Request): Promise<Response> {
  if (!process.env.RECUT_DASHSCOPE_API_KEY) {
    return Response.json({ error: 'server not in live mode' }, { status: 501 });
  }
  const body = (await req.json().catch(() => ({}))) as { hint?: string };
  const hint = body.hint?.trim();
  if (!hint) return Response.json({ error: 'hint required' }, { status: 400 });
  const gov = new BudgetGovernor();
  try {
    gov.assertCanSpend(QWEN_MAX.cost.amount);
    const text = await dashscopeText(PLAN_MODEL_ID, SYSTEM, `User's words: ${hint}\n\nWrite the style prefix.`);
    gov.record(QWEN_MAX.cost.amount);
    const style = text.trim().replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 400);
    return Response.json({ style, spentUsd: gov.spent() });
  } catch (e) {
    return Response.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
