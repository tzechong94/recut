// Server-side project storage. Durable + shareable (anyone with the project id loads the same
// graph). File-backed under .recut/projects/<id>.json — a real DB (Prisma/Postgres) is the
// production swap, but the read/save contract here is identical.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface StoredProject {
  id: string;
  title: string;
  createdAt: number;
  nodes: unknown[];
  edges: unknown[];
}
export type ProjectMeta = Pick<StoredProject, 'id' | 'title' | 'createdAt'>;

function dir(): string {
  const d = resolve(process.cwd(), '.recut/projects');
  mkdirSync(d, { recursive: true });
  return d;
}
function pathOf(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('bad project id');
  return join(dir(), `${id}.json`);
}

export function listProjects(): ProjectMeta[] {
  return readdirSync(dir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const p = JSON.parse(readFileSync(join(dir(), f), 'utf8')) as StoredProject;
        return { id: p.id, title: p.title, createdAt: p.createdAt };
      } catch {
        return null;
      }
    })
    .filter((m): m is ProjectMeta => m !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
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
  return { id, title: project.title, createdAt };
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
