'use client';

import { use, useEffect, useState } from 'react';
import { getProject } from '../../../../lib/projects';
import { Monitor } from '../../../../components/pipeline/Monitor';

export default function PipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [title, setTitle] = useState('Untitled');
  useEffect(() => {
    getProject(id).then((p) => p && setTitle(p.title));
  }, [id]);
  return <Monitor projectId={id} title={title} />;
}
