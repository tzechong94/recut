// "Better Together" — Mr Bean × Black Sesame, 16:9 Studio Ghibli ad. Runs the REAL product
// pipeline live (same endpoints the canvas uses): Canon → edit/compose → i2v → assemble.
//   RECUT_PORT=4700 tsx scripts/mrbean-ad.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = `http://127.0.0.1:${process.env.RECUT_PORT ?? '4700'}`;
const STYLE = 'Studio Ghibli style, soft hand-painted watercolor, warm naturalistic cinematic lighting, delicate anime, widescreen 16:9';
const GEN = `${BASE}/api/generate`;
const OUT = resolve('public/generated');
mkdirSync(OUT, { recursive: true });

function logoDataUri(): string {
  return 'data:image/jpeg;base64,' + readFileSync(resolve('public/refs/mrbean-logo.jpg')).toString('base64');
}
async function gen(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(GEN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await r.json()) as Record<string, unknown>;
}
async function save(url: string, name: string): Promise<void> {
  const r = await fetch(url);
  writeFileSync(resolve(OUT, name), Buffer.from(await r.arrayBuffer()));
}
async function i2v(image: string, prompt: string, label: string): Promise<string> {
  const s = await gen({ kind: 'video', image, prompt: `${prompt}, ${STYLE}` });
  if (!s.taskId) throw new Error(`${label} submit: ${s.error}`);
  console.log(`   … ${label}: i2v submitted, polling`);
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 6000));
    const st = (await (await fetch(`${BASE}/api/generate/status?taskId=${s.taskId}`)).json()) as { status?: string; videoUrl?: string; error?: string };
    if (st.status === 'done' && st.videoUrl) return st.videoUrl;
    if (st.status === 'failed') throw new Error(`${label}: ${st.error}`);
  }
  throw new Error(`${label}: timed out`);
}

async function main(): Promise<void> {
  console.log('▶ CANON');
  const soy = String((await gen({ kind: 'edit', image: logoDataUri(), prompt: `Isolate ONLY the soybean mascot from this logo, ignore all text. Full body, centered, plain white background. Keep its exact design: cream-beige oval body, small green sprout leaf on top, simple smiley face, slender arms and legs. ${STYLE}` })).imageUrl ?? '');
  if (!soy) throw new Error('SOY canon failed');
  await save(soy, 'ad-soy.png'); console.log('   ✓ SOY mascot locked → ad-soy.png');
  const kuro = String((await gen({ kind: 'text2image', prompt: `A tiny cute black sesame seed character, glossy black oval body, big round friendly eyes, shy smile, slender little limbs, gentle children's-book mascot, plain white background. ${STYLE}` })).imageUrl ?? '');
  if (!kuro) throw new Error('KURO canon failed');
  await save(kuro, 'ad-kuro.png'); console.log('   ✓ KURO black-sesame locked → ad-kuro.png');

  console.log('▶ SHOTS (image → i2v)');
  // S1 establishing
  const s1 = String((await gen({ kind: 'text2image', prompt: `Wide establishing shot, eye level, a cozy sunlit kitchen table by a window in the morning, a tall glass of soy milk on the table, warm light, no text. ${STYLE}` })).imageUrl ?? '');
  await save(s1, 'ad-shot1.png');
  // S2 edit SOY into scene, three-quarter MCU
  const s2 = String((await gen({ kind: 'edit', image: soy, prompt: `Place this soybean mascot sitting beside a glass of soy milk on a sunlit kitchen table, medium close-up, three-quarter front angle, looking up curious and happy. Keep the mascot's exact design. warm morning light.` })).imageUrl ?? '');
  await save(s2, 'ad-shot2.png');
  // S3 compose SOY + KURO meeting, profile two-shot
  const s3 = String((await gen({ kind: 'compose', images: [soy, kuro], prompt: `The soybean mascot and the little black sesame character meet on a sunlit kitchen table, profile two-shot facing each other, the black sesame looks up shyly, the soybean smiles warmly. Keep both characters' exact designs.` })).imageUrl ?? '');
  await save(s3, 'ad-shot3.png');
  // S4 hero product, high angle
  const s4 = String((await gen({ kind: 'compose', images: [soy, kuro], prompt: `High angle hero product shot: the soybean mascot and the black sesame character happily beside a tall glass of creamy black sesame soy milk with a grey-purple swirl, condensation on the glass, warm cozy light, beauty shot, no text.` })).imageUrl ?? '');
  await save(s4, 'ad-shot4.png');
  console.log('   ✓ 4 shot frames → ad-shot1..4.png');

  console.log('▶ ANIMATE (real wan2.6-i2v)');
  const c1 = await i2v(s1, 'gentle morning light shifts, soft steam rises from the glass, leaves sway outside the window, static camera', 'S1');
  const c2 = await i2v(s2, 'the soybean mascot blinks and tilts its head curiously, slow gentle push-in', 'S2');
  const c3 = await i2v(s3, 'the black sesame hops closer and the soybean waves hello, both smile warmly', 'S3');
  const c4 = await i2v(s4, 'the black sesame soy milk swirls creamily in the glass, the characters smile, slow subtle rotate', 'S4');
  const clips = [c1, c2, c3, c4];

  console.log('▶ VOICE');
  const vo = String((await gen({ kind: 'dialogue', prompt: 'Mr Bean Black Sesame. Better together.', voice: 'Chelsie' })).audioUrl ?? '');
  console.log(vo ? '   ✓ VO synthesized' : '   ✗ VO failed (continuing silent)');

  console.log('▶ ASSEMBLE');
  const asm = await fetch(`${BASE}/api/assemble`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clips, audio: vo ? [vo] : [], lut: 'warm-film', vertical: false }) });
  if (!asm.ok) throw new Error('assemble: ' + JSON.stringify(await asm.json()));
  const buf = Buffer.from(await asm.arrayBuffer());
  writeFileSync(resolve(OUT, 'mrbean-ad.mp4'), buf);
  console.log(`\n✅ FILM → public/generated/mrbean-ad.mp4 (${(buf.length / 1024).toFixed(0)} KB)`);
}
main().catch((e) => { console.error('FAILED:', String(e)); process.exit(1); });
