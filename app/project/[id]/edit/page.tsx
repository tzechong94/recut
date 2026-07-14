'use client';

import { use, useEffect, useState } from 'react';
import { getProject } from '../../../../lib/projects';
import { FilmEditor } from '../../../../components/editor/FilmEditor';

export default function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [title, setTitle] = useState('Untitled');
  useEffect(() => {
    getProject(id).then((p) => p && setTitle(p.title));
  }, [id]);
  return <FilmEditor projectId={id} title={title} />;
}
