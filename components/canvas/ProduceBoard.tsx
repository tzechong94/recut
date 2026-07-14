'use client';

import { useState } from 'react';
import type { Take } from '../../lib/domain/types';

interface Props {
  shotAction: string;
  sceneTitle: string;
  entityName: string;
  takes: Take[];
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** The exact instruction text sent to the model (from the serialized provider payload). */
function promptOf(take: Take): string {
  const messages = (take.provenance.serializedPayload as { messages?: Array<{ content?: Array<{ text?: string }> }> })?.messages;
  const content = messages?.[0]?.content;
  const textPart = Array.isArray(content) ? content.find((p) => typeof p.text === 'string') : undefined;
  return textPart?.text ?? '';
}

export function ProduceBoard({ shotAction, sceneTitle, entityName, takes }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acceptedId, setAcceptedId] = useState<string | null>(null);

  const selected = takes.find((t) => t.id === selectedId) ?? null;
  const accepted = takes.find((t) => t.id === acceptedId) ?? null;
  const totalCost = takes.reduce((a, t) => a + t.provenance.costUsd, 0);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-8 py-10 lg:grid-cols-[1fr_20rem]">
      {/* Canvas node */}
      <section
        data-testid="shot-node"
        className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5"
      >
        <header className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="rounded bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-300" data-testid="capability-badge">
              image.edit
            </span>
            <span className="text-xs text-neutral-500">{sceneTitle}</span>
          </div>
          <div className="flex items-center gap-3 text-xs tabular-nums text-neutral-500">
            <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-emerald-400" data-testid="status">
              cached
            </span>
            <span>{money(totalCost)}</span>
          </div>
        </header>

        <p className="mb-4 text-sm text-neutral-300">
          <span className="text-neutral-500">Shot · </span>
          {shotAction}
          <span className="text-neutral-500"> · with </span>
          {entityName}
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="candidates">
          {takes.map((t) => {
            const isSel = t.id === selectedId;
            const isAcc = t.id === acceptedId;
            return (
              <button
                key={t.id}
                data-testid="candidate"
                onClick={() => setSelectedId(t.id)}
                className={[
                  'group relative aspect-video overflow-hidden rounded-lg border text-left transition',
                  isAcc
                    ? 'border-emerald-400 ring-2 ring-emerald-400/40'
                    : isSel
                      ? 'border-sky-400 ring-2 ring-sky-400/40'
                      : 'border-neutral-800 hover:border-neutral-600',
                ].join(' ')}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.assetUrl} alt={`candidate seed ${t.provenance.seed}`} className="h-full w-full object-cover" />
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-300">
                  seed {t.provenance.seed}
                </span>
                {isAcc && (
                  <span className="absolute top-1 right-1 rounded bg-emerald-400 px-1.5 py-0.5 text-[10px] font-semibold text-black">
                    Take
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {selected && !accepted && (
          <button
            data-testid="accept"
            onClick={() => setAcceptedId(selected.id)}
            className="mt-4 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400"
          >
            Accept as Take
          </button>
        )}
      </section>

      {/* Provenance / export */}
      <aside className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 text-sm">
        {/* Prompt — visible as soon as you select a candidate */}
        {(selected ?? accepted) ? (
          <div className="mb-5" data-testid="prompt-panel">
            <h2 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
              Prompt sent {selected && !accepted ? `· seed ${selected.provenance.seed}` : ''}
            </h2>
            <p className="max-h-40 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 font-mono text-[11px] leading-relaxed text-neutral-300">
              {promptOf((accepted ?? selected)!)}
            </p>
          </div>
        ) : null}

        <h2 className="mb-3 text-xs font-semibold tracking-widest text-neutral-500 uppercase">Provenance</h2>
        {accepted ? (
          <dl data-testid="provenance" className="space-y-2 text-neutral-300">
            <Row k="Model" v={accepted.provenance.modelId} />
            <Row k="Capability" v={accepted.provenance.capability} />
            <Row k="Seed" v={String(accepted.provenance.seed)} />
            <Row k="Shot size" v={accepted.provenance.compiledPrompt.camera.shotSize} />
            <Row k="Latency" v={`${accepted.provenance.latencyMs} ms`} />
            <Row k="Cost" v={money(accepted.provenance.costUsd)} />
            <Row k="Canon v" v={String(accepted.provenance.bibleVersion)} />
            <Row k="Cache hash" v={accepted.provenance.cacheHash.slice(0, 16) + '…'} mono />
            <a
              data-testid="export"
              href={accepted.assetUrl}
              download
              className="mt-3 block rounded-lg border border-neutral-700 px-4 py-2 text-center text-sm font-medium text-neutral-100 hover:bg-neutral-800"
            >
              Export frame
            </a>
          </dl>
        ) : (
          <p className="text-neutral-500">Select a candidate to see its exact prompt; accept it as the Take for full provenance and export.</p>
        )}
      </aside>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-neutral-500">{k}</dt>
      <dd className={mono ? 'font-mono text-xs text-neutral-400' : 'tabular-nums text-neutral-200'}>{v}</dd>
    </div>
  );
}
