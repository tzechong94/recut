// Server-side project storage. Durable + shareable (anyone with the project id loads the same
// graph). File-backed under .recut/projects/<id>.json — a real DB (Prisma/Postgres) is the
// production swap, but the read/save contract here is identical.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface StoredProject {
  id: string;
  title: string;
  createdAt: number;
  nodes: unknown[];
  edges: unknown[];
}
// A gallery card: enough to render a project tile without loading its whole graph.
export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  thumbUrl: string | null;
}

// The project store root. Overridable via RECUT_DATA_DIR so e2e/tests write to an isolated
// temp dir instead of polluting the real .recut/projects the app reads.
function dir(): string {
  const d = process.env.RECUT_DATA_DIR
    ? resolve(process.env.RECUT_DATA_DIR)
    : resolve(process.cwd(), '.recut/projects');
  mkdirSync(d, { recursive: true });
  return d;
}
function pathOf(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('bad project id');
  return join(dir(), `${id}.json`);
}

// First rendered still in the graph → the project's poster frame.
function posterOf(nodes: unknown[]): string | null {
  for (const n of nodes as Array<{ data?: { imageUrl?: string } }>) {
    const url = n?.data?.imageUrl;
    if (typeof url === 'string' && url.length > 0) return url;
  }
  return null;
}

export function listProjects(): ProjectMeta[] {
  const d = dir();
  return readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const full = join(d, f);
        const p = JSON.parse(readFileSync(full, 'utf8')) as StoredProject;
        const nodes = p.nodes ?? [];
        return {
          id: p.id,
          title: p.title,
          createdAt: p.createdAt,
          updatedAt: statSync(full).mtimeMs,
          nodeCount: nodes.length,
          thumbUrl: posterOf(nodes),
        };
      } catch {
        return null;
      }
    })
    .filter((m): m is ProjectMeta => m !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: string): StoredProject | null {
  const p = pathOf(id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as StoredProject;
}

export function createProject(title: string, createdAt: number): ProjectMeta {
  const id = randomUUID().slice(0, 8);
  const project: StoredProject = { id, title: title.trim() || 'Untitled project', createdAt, nodes: [], edges: [] };
  writeFileSync(pathOf(id), JSON.stringify(project, null, 2));
  return { id, title: project.title, createdAt, updatedAt: createdAt, nodeCount: 0, thumbUrl: null };
}

export function saveGraph(id: string, nodes: unknown[], edges: unknown[]): void {
  const existing = getProject(id);
  if (!existing) return;
  writeFileSync(pathOf(id), JSON.stringify({ ...existing, nodes, edges }, null, 2));
}

export function deleteProject(id: string): void {
  const p = pathOf(id);
  if (existsSync(p)) rmSync(p);
}
