import Link from 'next/link';
import { STEPS } from '../components/Nav';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-8">
      <p className="text-sm font-medium tracking-widest text-neutral-500 uppercase">Recut</p>
      <h1 className="text-4xl font-semibold text-balance">
        Every other tool gives you shots. Recut gives you a series.
      </h1>
      <p className="max-w-xl text-neutral-400">
        An AI showrunner that writes and directs a short drama — with a Series Bible, a
        continuity critic, and camera rigs that compile cinematography from nothing.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/studio"
          data-testid="cta-start"
          className="rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-black hover:bg-sky-400"
        >
          Start the walkthrough →
        </Link>
        <span className="text-xs text-neutral-600">5 steps · Bible → Rig → Produce → Continuity → Timeline</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <Link
            key={s.slug}
            href={s.path}
            className="rounded-md border border-neutral-800 px-2.5 py-1 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
          >
            {i + 1}. {s.label}
          </Link>
        ))}
      </div>

      <div data-testid="harness-status" className="mt-2 text-xs text-neutral-600">
        harness: replay mode · zero video tokens pre-approval
      </div>
    </main>
  );
}
