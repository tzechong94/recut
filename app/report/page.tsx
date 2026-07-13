import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Gateway } from '../../lib/gateway/jobs';
import { critique } from '../../lib/agent/critic';
import { ReportCard, type ReportRow } from '../../components/canvas/ReportCard';

export const dynamic = 'force-dynamic';

interface Case { name: string; takeUrl: string; refUrls: string[]; intent: string }

export default async function ReportPage() {
  const path = resolve('fixtures/continuity-cases.json');
  const cases: Case[] = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Case[]) : [];
  const gw = new Gateway({ mode: 'replay' });

  const rows: ReportRow[] = [];
  for (const c of cases) {
    const r = await critique(c.takeUrl, c.refUrls, c.intent, { gateway: gw });
    rows.push({ name: c.name, thumb: c.takeUrl, score: r.score, verdict: r.verdict });
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-neutral-900 px-8 py-4">
        <h1 className="text-sm font-semibold tracking-wide text-neutral-200">
          The Letter <span className="text-neutral-600">· continuity</span>
        </h1>
      </header>
      <ReportCard rows={rows} />
    </main>
  );
}
