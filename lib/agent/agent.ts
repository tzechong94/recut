// The showrunner agent's state IS the graph (the Project), not a chat log. It applies tool
// calls that mutate the canvas transactionally. Guardrails: a per-run spend cap (stops at 80%),
// and it never deletes a user-accepted take. Tool calls come from qwen3-max (live) or a scripted
// list (tests) — the runner is identical either way.

import type { Project, Scene, Shot, Entity, EntityKind } from '../domain/types';
import type { AssetRef } from '../gateway/types';
import { defaultCamera, defaultLight } from '../domain/defaults';
import { planCoverage, type Beat } from './plan';

export type ToolCall =
  | { tool: 'create_scene'; args: { title: string } }
  | { tool: 'cast_entity'; args: { name: string; kind: EntityKind; description?: string; refs?: AssetRef[]; attributes?: Record<string, string> } }
  | { tool: 'create_shot'; args: { sceneId: string; action: string; entityIds: string[] } }
  | { tool: 'set_camera'; args: { shotId: string; camera: Partial<Shot['camera']> } }
  | { tool: 'set_light'; args: { shotId: string; light: Shot['light'] } }
  | { tool: 'plan_coverage'; args: { sceneId: string; beat: Beat; entityIds: string[] } }
  | { tool: 'delete_shot'; args: { shotId: string } };

export interface AgentEffect {
  tool: string;
  createdId?: string;
  note?: string;
  estCostUsd?: number;
}

export interface AgentRun {
  project: Project;
  log: AgentEffect[];
  stopped?: { reason: 'budget'; atUsd: number };
  spentEstUsd: number;
}

export class AcceptedTakeProtected extends Error {
  constructor(shotId: string) {
    super(`refusing to delete shot ${shotId}: it has a user-accepted take`);
    this.name = 'AcceptedTakeProtected';
  }
}

function count<T>(arr: T[]): number {
  return arr.length;
}

function applyCall(project: Project, call: ToolCall): { project: Project; effect: AgentEffect } {
  switch (call.tool) {
    case 'create_scene': {
      const id = `scene${count(project.scenes) + 1}`;
      const scene: Scene = { id, title: call.args.title, shotIds: [] };
      return { project: { ...project, scenes: [...project.scenes, scene] }, effect: { tool: call.tool, createdId: id } };
    }
    case 'cast_entity': {
      const id = `entity${count(project.bible.entities) + 1}`;
      const entity: Entity = {
        id, kind: call.args.kind, name: call.args.name, description: call.args.description ?? '',
        refs: call.args.refs ?? [], attributes: call.args.attributes ?? {}, version: project.bible.version,
      };
      return { project: { ...project, bible: { ...project.bible, entities: [...project.bible.entities, entity] } }, effect: { tool: call.tool, createdId: id } };
    }
    case 'create_shot': {
      const id = `shot${count(project.shots) + 1}`;
      const shot: Shot = { id, sceneId: call.args.sceneId, action: call.args.action, entityIds: call.args.entityIds, camera: defaultCamera(), light: defaultLight(), takeIds: [] };
      const scenes = project.scenes.map((s) => (s.id === call.args.sceneId ? { ...s, shotIds: [...s.shotIds, id] } : s));
      return { project: { ...project, shots: [...project.shots, shot], scenes }, effect: { tool: call.tool, createdId: id } };
    }
    case 'set_camera': {
      const shots = project.shots.map((s) => (s.id === call.args.shotId ? { ...s, camera: { ...s.camera, ...call.args.camera } } : s));
      return { project: { ...project, shots }, effect: { tool: call.tool, note: call.args.shotId } };
    }
    case 'set_light': {
      const shots = project.shots.map((s) => (s.id === call.args.shotId ? { ...s, light: call.args.light } : s));
      return { project: { ...project, shots }, effect: { tool: call.tool, note: call.args.shotId } };
    }
    case 'plan_coverage': {
      // expand a beat into multiple create_shot calls following editorial grammar
      let p = project;
      const planned = planCoverage(call.args.beat);
      for (const ps of planned) {
        const r = applyCall(p, { tool: 'create_shot', args: { sceneId: call.args.sceneId, action: ps.action, entityIds: call.args.entityIds } });
        p = r.project;
      }
      return { project: p, effect: { tool: call.tool, note: `${planned.length} shots (${planned.map((x) => x.shotSize).join(',')})` } };
    }
    case 'delete_shot': {
      const shot = project.shots.find((s) => s.id === call.args.shotId);
      if (shot?.acceptedTakeId) throw new AcceptedTakeProtected(shot.id); // hard rule 9
      const shots = project.shots.filter((s) => s.id !== call.args.shotId);
      const scenes = project.scenes.map((s) => ({ ...s, shotIds: s.shotIds.filter((id) => id !== call.args.shotId) }));
      return { project: { ...project, shots, scenes }, effect: { tool: call.tool, note: call.args.shotId } };
    }
  }
}

// crude per-tool spend estimate for the budget bar (render happens later, out of band)
const TOOL_COST: Record<string, number> = { plan_coverage: 0, create_scene: 0, cast_entity: 0, create_shot: 0, set_camera: 0, set_light: 0, delete_shot: 0 };

export function runAgent(project: Project, calls: ToolCall[], opts: { spendCapUsd?: number } = {}): AgentRun {
  const cap = opts.spendCapUsd ?? Infinity;
  const stopAt = cap * 0.8; // agent stops and asks at 80%
  let p = project;
  const log: AgentEffect[] = [];
  let spent = 0;
  for (const call of calls) {
    const cost = TOOL_COST[call.tool] ?? 0;
    if (spent + cost > stopAt && cap !== Infinity) {
      return { project: p, log, stopped: { reason: 'budget', atUsd: spent }, spentEstUsd: spent };
    }
    const { project: next, effect } = applyCall(p, call);
    p = next;
    spent += cost;
    log.push({ ...effect, estCostUsd: cost });
  }
  return { project: p, log, spentEstUsd: spent };
}
