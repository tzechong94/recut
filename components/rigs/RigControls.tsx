'use client';

import { useMemo, useState } from 'react';
import type { CameraRigState, LightRigState } from '../../lib/domain/types';
import { compile } from '../../lib/compiler/compile';
import { promptSentence } from '../../serializers/dashscope';

const EMPTY_BIBLE = { version: 1, entities: [] };

function Slider({
  label, value, min, max, step, unit, onChange, testid,
}: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void; testid: string;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-neutral-400">{label}</span>
        <span className="text-xs tabular-nums text-neutral-200" data-testid={`${testid}-val`}>
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        data-testid={testid}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-sky-400"
      />
    </label>
  );
}

export function RigControls({
  initialCamera, initialLight, subject, action,
}: {
  initialCamera: CameraRigState; initialLight: LightRigState; subject: string; action: string;
}) {
  const [cam, setCam] = useState(initialCamera);
  const [light, setLight] = useState(initialLight);

  const compiled = useMemo(
    () =>
      compile({
        shot: { id: 'rig', sceneId: 'rig', action, entityIds: [], camera: cam, light, takeIds: [] },
        bible: EMPTY_BIBLE,
      }),
    [cam, light, action],
  );
  const sentence = useMemo(() => promptSentence({ ...compiled, subject: { entityIds: [], description: subject } }), [compiled, subject]);

  const key = light.lights.find((l) => l.role === 'key') ?? light.lights[0]!;
  const setKey = (patch: Partial<typeof key>) =>
    setLight((l) => ({ lights: l.lights.map((x) => (x.role === 'key' ? { ...x, ...patch } : x)) }));

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-8 py-8 lg:grid-cols-[22rem_1fr]">
      <section className="space-y-5 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <div>
          <h2 className="mb-3 text-xs font-semibold tracking-widest text-neutral-500 uppercase">Camera</h2>
          <div className="space-y-4">
            <Slider label="Azimuth" testid="cam-azimuth" value={cam.azimuthDeg} min={-180} max={180} step={5} unit="°" onChange={(v) => setCam((c) => ({ ...c, azimuthDeg: v }))} />
            <Slider label="Elevation" testid="cam-elevation" value={cam.elevationDeg} min={-45} max={80} step={5} unit="°" onChange={(v) => setCam((c) => ({ ...c, elevationDeg: v }))} />
            <Slider label="Distance" testid="cam-distance" value={cam.distanceM} min={0.6} max={12} step={0.1} unit="m" onChange={(v) => setCam((c) => ({ ...c, distanceM: v }))} />
            <Slider label="Focal length" testid="cam-focal" value={cam.focalMm} min={14} max={200} step={1} unit="mm" onChange={(v) => setCam((c) => ({ ...c, focalMm: v }))} />
            <Slider label="Aperture" testid="cam-aperture" value={cam.aperture} min={1.2} max={16} step={0.1} unit=" f" onChange={(v) => setCam((c) => ({ ...c, aperture: v }))} />
          </div>
        </div>
        <div>
          <h2 className="mb-3 text-xs font-semibold tracking-widest text-neutral-500 uppercase">Key light</h2>
          <div className="space-y-4">
            <Slider label="Key azimuth" testid="key-azimuth" value={key.azimuthDeg} min={-180} max={180} step={5} unit="°" onChange={(v) => setKey({ azimuthDeg: v })} />
            <Slider label="Key elevation" testid="key-elevation" value={key.elevationDeg} min={-20} max={90} step={5} unit="°" onChange={(v) => setKey({ elevationDeg: v })} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h2 className="mb-3 text-xs font-semibold tracking-widest text-neutral-500 uppercase">Detected</h2>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Chip label="Shot size" value={compiled.camera.shotSize} testid="d-shotsize" />
            <Chip label="Angle" value={`${compiled.camera.angle.elevation}/${compiled.camera.angle.azimuth}`} testid="d-angle" />
            <Chip label="DoF" value={compiled.camera.dof} testid="d-dof" />
            <Chip label="Lighting" value={compiled.lighting.setup} testid="d-setup" />
          </div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h2 className="mb-3 text-xs font-semibold tracking-widest text-neutral-500 uppercase">Compiled prompt</h2>
          <p data-testid="compiled-sentence" className="font-mono text-sm leading-relaxed text-neutral-200">
            {sentence}
          </p>
        </div>
      </section>
    </div>
  );
}

function Chip({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2">
      <div className="text-[10px] tracking-wide text-neutral-500 uppercase">{label}</div>
      <div className="text-sm font-medium text-sky-300" data-testid={testid}>{value}</div>
    </div>
  );
}
