import { ProjectShell } from '../../../components/canvas/ProjectShell';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectShell id={id} />;
}
