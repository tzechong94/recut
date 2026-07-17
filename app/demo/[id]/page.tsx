'use client';

import { use, useEffect, useState } from 'react';
import { getProject } from '../../../lib/projects';
import { Walkthrough } from '../../../components/demo/Walkthrough';

export default function DemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [title, setTitle] = useState('…');
  useEffect(() => {
    getProject(id).then((p) => p && setTitle(p.title));
  }, [id]);
  return <Walkthrough projectId={id} title={title} />;
}
