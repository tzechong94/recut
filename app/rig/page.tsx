import { defaultCamera, defaultLight } from '../../lib/domain/defaults';
import { RigControls } from '../../components/rigs/RigControls';

export default function RigPage() {
  return (
    <main className="min-h-screen">
      <header className="border-b border-neutral-900 px-8 py-4">
        <h1 className="text-sm font-semibold tracking-wide text-neutral-200">
          Camera &amp; light rig <span className="text-neutral-600">· drag to compile cinematography</span>
        </h1>
      </header>
      <RigControls
        initialCamera={defaultCamera()}
        initialLight={defaultLight()}
        subject="Mei, black bob, red wool scarf, charcoal jacket"
        action="Mei looks up from the letter"
      />
    </main>
  );
}
