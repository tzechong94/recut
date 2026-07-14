import { loadDemoProject } from '../../lib/domain/loadDemo';
import { Gateway } from '../../lib/gateway/jobs';
import { generateKeyframes } from '../../lib/pipeline/keyframes';
import { ProduceBoard } from '../../components/canvas/ProduceBoard';
import { Nav } from '../../components/Nav';

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
      <Nav current="produce" />
      <ProduceBoard
        shotAction={shot.action}
        sceneTitle={scene?.title ?? 'Scene'}
        entityName={entity?.name ?? 'entity'}
        takes={takes}
      />
    </main>
  );
}
