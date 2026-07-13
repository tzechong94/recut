import { Timeline, type Clip } from '../../components/timeline/Timeline';

// Ordered accepted takes → clips. Posters are the approved keyframes (video is animation of an
// approved keyframe); the real clips live in public/clips as pre-generated mp4s.
const CLIPS: Clip[] = [
  { id: 'shot1', poster: '/takes/1000.png', label: 'Mei looks up', seconds: 3 },
  { id: 'shot2', poster: '/takes/1001.png', label: 'closer', seconds: 3 },
  { id: 'shot3', poster: '/takes/1002.png', label: 'the letter', seconds: 3 },
];

export default function TimelinePage() {
  return (
    <main className="min-h-screen">
      <header className="border-b border-neutral-900 px-8 py-4">
        <h1 className="text-sm font-semibold tracking-wide text-neutral-200">
          The Letter <span className="text-neutral-600">· timeline &amp; grade</span>
        </h1>
      </header>
      <Timeline clips={CLIPS} />
    </main>
  );
}
