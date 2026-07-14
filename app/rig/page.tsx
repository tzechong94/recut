import { defaultCamera, defaultLight } from '../../lib/domain/defaults';
import { RigControls } from '../../components/rigs/RigControls';
import { Nav } from '../../components/Nav';

export default function RigPage() {
  return (
    <main className="min-h-screen">
      <Nav current="rig" />
      <RigControls
        initialCamera={defaultCamera()}
        initialLight={defaultLight()}
        subject="Mei, black bob, red wool scarf, charcoal jacket"
        action="Mei looks up from the letter"
      />
    </main>
  );
}
