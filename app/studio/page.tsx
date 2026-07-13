import { loadDemoProject } from '../../lib/domain/loadDemo';
import { Gateway } from '../../lib/gateway/jobs';
import { generateKeyframes, acceptTake } from '../../lib/pipeline/keyframes';
import { StudioClient } from '../../components/canvas/StudioClient';

export const dynamic = 'force-dynamic';

export default async function StudioPage() {
  const base = loadDemoProject();
  const shot = base.shots[0]!;
  const takes = await generateKeyframes(base, shot, { gateway: new Gateway({ mode: 'replay' }) });
  // seed an accepted take so the canvas shows a finished shot
  let project = { ...base, takes };
  project = acceptTake(project, shot, takes[0]!.id);

  return <StudioClient initialProject={project} />;
}
