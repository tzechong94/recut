import { getPipeline } from '../../../../lib/server/pipelineStore';
import { getProject } from '../../../../lib/server/projectStore';
import { renderShotlistHtml } from '../../../../lib/pipeline/shotlistHtml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The seedance-shotlist-director HTML artifact for a project's pipeline. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const doc = getPipeline(id);
  const title = getProject(id)?.title ?? 'Untitled';
  return new Response(renderShotlistHtml(doc, title), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `inline; filename="shotlist-${id}.html"` },
  });
}
