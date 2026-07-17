import { getPipeline, savePipeline } from '../../../../lib/server/pipelineStore';
import type { PipelineDoc } from '../../../../lib/pipeline/doc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return Response.json(getPipeline(id));
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as PipelineDoc | null;
  if (!body || !Array.isArray(body.assets) || !Array.isArray(body.scenes)) {
    return Response.json({ error: 'bad pipeline doc' }, { status: 400 });
  }
  const saved = savePipeline({ ...body, projectId: id });
  return Response.json({ ok: true, rev: saved.rev });
}
