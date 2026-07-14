import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvas } from '../store';

const at = (x = 0, y = 0) => ({ x, y });
const S = () => useCanvas.getState();

beforeEach(() => S().reset());

describe('canvas store — nodes & history', () => {
  it('adds nodes and can undo/redo', () => {
    S().addNode('text2image', at());
    S().addNode('edit', at());
    expect(S().nodes).toHaveLength(2);
    S().undo();
    expect(S().nodes).toHaveLength(1);
    S().redo();
    expect(S().nodes).toHaveLength(2);
  });

  it('duplicate and delete', () => {
    S().addNode('text2image', at());
    const id = S().nodes[0]!.id;
    S().duplicateNode(id);
    expect(S().nodes).toHaveLength(2);
    S().deleteNode(id);
    expect(S().nodes.find((n) => n.id === id)).toBeUndefined();
  });
});

describe('canvas store — typed ports', () => {
  it('allows image→image.edit, refuses image→audio.tts', () => {
    S().addNode('canon', at()); // n1, image.generate
    S().addNode('edit', at()); // n2, image.edit
    S().addNode('dialogue', at()); // n3, audio.tts
    const [n1, n2, n3] = S().nodes.map((n) => n.id);
    S().onConnect({ source: n1!, target: n2!, sourceHandle: null, targetHandle: null });
    expect(S().edges).toHaveLength(1);
    S().onConnect({ source: n1!, target: n3!, sourceHandle: null, targetHandle: null });
    expect(S().edges).toHaveLength(1); // refused
    expect(S().lastError).toMatch(/cannot feed/);
  });
});

describe('canvas store — Canon stale propagation', () => {
  it('canon node initializes locked with an entity kind', () => {
    S().addNode('canon', at());
    const d = S().nodes[0]!.data;
    expect(d.kind).toBe('canon');
    expect(d.locked).toBe(true);
    expect(d.entityKind).toBe('character');
  });

  it('changing a canon reference flags every downstream node stale', () => {
    S().addNode('canon', at()); // n1
    S().addNode('edit', at()); // n2
    S().addNode('video', at()); // n3
    const [n1, n2, n3] = S().nodes.map((n) => n.id);
    S().onConnect({ source: n1!, target: n2!, sourceHandle: null, targetHandle: null });
    S().onConnect({ source: n2!, target: n3!, sourceHandle: null, targetHandle: null });
    // pretend the downstream nodes had already produced outputs
    S().updateNode(n2!, { status: 'done', imageUrl: 'x' });
    S().updateNode(n3!, { status: 'done', videoUrl: 'y' });

    S().setCanonRef(n1!, 'data:image/png;base64,AAAA');

    const byId = Object.fromEntries(S().nodes.map((n) => [n.id, n.data]));
    expect(byId[n1!]!.imageUrl).toContain('data:image'); // canon updated
    expect(byId[n1!]!.stale).toBe(false); // the canon itself isn't stale
    expect(byId[n2!]!.stale).toBe(true); // direct descendant
    expect(byId[n3!]!.stale).toBe(true); // transitive descendant
  });
});
