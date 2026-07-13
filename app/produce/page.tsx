import { loadDemoProject } from '../../lib/domain/loadDemo';
import { Gateway } from '../../lib/gateway/jobs';
import { generateKeyframes } from '../../lib/pipeline/keyframes';
import { ProduceBoard } from '../../components/canvas/ProduceBoard';

// Runs the pipeline at request time in replay (zero network). Never prerender.
export const dynamic = 'force-dynamic';

export default async function ProducePage() {
  const project = loadDemoProject();
  const shot = project.shots[0]!;
  const entity = project.bible.entities.find((e) => e.id === shot.entityIds[0]);
  const scene = project.scenes.find((s) => s.id === shot.sceneId);

  // Force replay so a stray RECUT_MODE=live can never make the UI spend tokens.
  const gateway = new Gateway({ mode: 'replay' });
  const takes = await generateKeyframes(project, shot, { gateway });

  return (
    <main className="min-h-screen">
      <header className="border-b border-neutral-900 px-8 py-4">
        <h1 className="text-sm font-semibold tracking-wide text-neutral-200">
          {project.title} <span className="text-neutral-600">· produce</span>
        </h1>
      </header>
      <ProduceBoard
        shotAction={shot.action}
        sceneTitle={scene?.title ?? 'Scene'}
        entityName={entity?.name ?? 'entity'}
        takes={takes}
      />
    </main>
  );
}
