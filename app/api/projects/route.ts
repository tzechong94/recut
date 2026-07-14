import { listProjects, createProject } from '../../../lib/server/projectStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json({ projects: listProjects() });
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const meta = createProject(body.title ?? 'Untitled project', Date.now());
  return Response.json(meta);
}
