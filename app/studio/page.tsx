import { loadDemoProject } from '../../lib/domain/loadDemo';
import { Gateway } from '../../lib/gateway/jobs';
import { generateKeyframes, acceptTake } from '../../lib/pipeline/keyframes';
import { StudioClient } from '../../components/canvas/StudioClient';
import { Nav } from '../../components/Nav';

export const dynamic = 'force-dynamic';

export default async function StudioPage() {
  const base = loadDemoProject();
  const shot = base.shots[0]!;
  const takes = await generateKeyframes(base, shot, { gateway: new Gateway({ mode: 'replay' }) });
  // seed an accepted take so the canvas shows a finished shot
  let project = { ...base, takes };
  project = acceptTake(project, shot, takes[0]!.id);

  return (
    <main className="flex h-screen flex-col">
      <Nav current="studio" />
      <div className="min-h-0 flex-1">
        <StudioClient initialProject={project} />
      </div>
    </main>
  );
}
