import { loadDemoProject } from '../../lib/domain/loadDemo';
import { compile } from '../../lib/compiler/compile';
import { serializeImageEdit } from '../../serializers/dashscope';
import { buildDemoGraph } from '../../lib/demo/graph';
import { DemoCanvas } from '../../components/canvas/DemoCanvas';

export const dynamic = 'force-dynamic';

export default function DemoPage() {
  const project = loadDemoProject();
  const shot = project.shots[0]!;
  const compiled = compile({ shot, bible: project.bible, seed: 1000 });
  const payload = serializeImageEdit(compiled) as { messages: Array<{ content: Array<{ text?: string }> }> };
  const keyframePrompt = payload.messages[0]?.content.find((p) => typeof p.text === 'string')?.text ?? '';
  const { nodes, edges } = buildDemoGraph(keyframePrompt);
  return <DemoCanvas nodes={nodes} edges={edges} />;
}
