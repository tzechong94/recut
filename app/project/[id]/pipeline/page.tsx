'use client';

import { use, useEffect, useState } from 'react';
import { getProject } from '../../../../lib/projects';
import { PipelineWizard } from '../../../../components/pipeline/PipelineWizard';

export default function PipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [title, setTitle] = useState('Untitled');
  useEffect(() => {
    getProject(id).then((p) => p && setTitle(p.title));
  }, [id]);
  return <PipelineWizard projectId={id} title={title} />;
}
