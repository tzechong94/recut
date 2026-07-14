import { getProject, saveGraph, deleteProject } from '../../../../lib/server/projectStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(project);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { nodes?: unknown[]; edges?: unknown[] };
  saveGraph(id, body.nodes ?? [], body.edges ?? []);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  deleteProject(id);
  return Response.json({ ok: true });
}
