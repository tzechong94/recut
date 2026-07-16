import type { ContinuityVerdict } from '../../lib/agent/critic';

export interface ReportRow {
  name: string;
  thumb: string;
  score: number;
  verdict: ContinuityVerdict;
}

const AXES: Array<{ key: keyof ContinuityVerdict; label: string }> = [
  { key: 'identity_match', label: 'identity' },
  { key: 'wardrobe_match', label: 'wardrobe' },
  { key: 'framing_match', label: 'framing' },
  { key: 'location_match', label: 'location' },
  { key: 'palette_match', label: 'palette' },
  { key: 'prop_match', label: 'prop' },
];

function cellClass(v: number): string {
  if (v >= 0.7) return 'bg-emerald-500/15 text-emerald-300';
  if (v >= 0.5) return 'bg-amber-500/15 text-amber-300';
  return 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40';
}

export function ReportCard({ rows }: { rows: ReportRow[] }) {
  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="text-lg font-semibold text-neutral-100">Continuity report card</h1>
      <p className="mt-1 mb-6 text-sm text-neutral-500">
        Weighted Continuity Score per take. One glance tells you which shot drifted off-model.
      </p>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/8 text-left text-[11px] tracking-wide text-neutral-500 uppercase">
              <th className="px-4 py-3 font-medium">Take</th>
              {AXES.map((a) => (
                <th key={a.key} className="px-3 py-3 text-center font-medium">{a.label}</th>
              ))}
              <th className="px-4 py-3 text-right font-medium">Continuity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} data-testid={`row-${r.name}`} className="border-b border-white/8 last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.thumb} alt={r.name} className="h-10 w-16 rounded object-cover" />
                    <span className="font-medium text-neutral-200">{r.name}</span>
                  </div>
                </td>
                {AXES.map((a) => {
                  const v = r.verdict[a.key] as number;
                  return (
                    <td key={a.key} className="px-3 py-3 text-center">
                      <span className={`inline-block w-12 rounded px-1.5 py-1 text-xs font-semibold tabular-nums ${cellClass(v)}`}>
                        {v.toFixed(2)}
                      </span>
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-right">
                  <span className={`inline-block rounded px-2 py-1 text-sm font-semibold tabular-nums ${cellClass(r.score)}`} data-testid={`score-${r.name}`}>
                    {r.score.toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
