'use client';

import { useEffect, useState } from 'react';
import { getProject } from '../../lib/projects';
import { Editor } from './Editor';

export function ProjectShell({ id }: { id: string }) {
  const [title, setTitle] = useState('Untitled project');
  useEffect(() => {
    getProject(id).then((p) => {
      if (p) setTitle(p.title);
    });
  }, [id]);
  return <Editor projectId={id} title={title} />;
}
