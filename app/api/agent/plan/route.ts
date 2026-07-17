import { BudgetGovernor } from '../../../../lib/gateway/budget';
import { dashscopeText } from '../../../../adapters/dashscope-text';
import { PLAN_MODEL_ID, QWEN_MAX } from '../../../../manifests/qwen-max';
import { planSystem, planUser, parsePlan } from '../../../../lib/agent/planner';
import { buildGraphFromPlan } from '../../../../lib/agent/build-graph';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  if (!process.env.RECUT_DASHSCOPE_API_KEY) {
    return Response.json({ error: 'server not in live mode (RECUT_DASHSCOPE_API_KEY unset)' }, { status: 501 });
  }
  let body: { premise?: string; cast?: Array<{ slug: string; kind: string }> };
  try {
    body = (await req.json()) as { premise?: string; cast?: Array<{ slug: string; kind: string }> };
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }
  const premise = body.premise?.trim();
  if (!premise) return Response.json({ error: 'premise required' }, { status: 400 });

  const gov = new BudgetGovernor();
  try {
    gov.assertCanSpend(QWEN_MAX.cost.amount);
    const text = await dashscopeText(PLAN_MODEL_ID, planSystem(), planUser(premise, body.cast ?? []));
    const plan = parsePlan(text);
    gov.record(QWEN_MAX.cost.amount);
    const graph = buildGraphFromPlan(plan);
    return Response.json({ plan, graph, spentUsd: gov.spent() });
  } catch (e) {
    return Response.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
