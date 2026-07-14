import Link from 'next/link';

// Guided walkthrough order — the demo flow. Each screen shows this bar so the user always
// knows where they are and what's next.
export const STEPS = [
  { slug: 'studio', path: '/studio', label: 'Bible & Canvas' },
  { slug: 'rig', path: '/rig', label: 'Rig' },
  { slug: 'produce', path: '/produce', label: 'Produce' },
  { slug: 'report', path: '/report', label: 'Continuity' },
  { slug: 'timeline', path: '/timeline', label: 'Timeline' },
] as const;

export type StepSlug = (typeof STEPS)[number]['slug'];

export function Nav({ current }: { current?: StepSlug }) {
  const idx = STEPS.findIndex((s) => s.slug === current);
  const next = idx >= 0 && idx < STEPS.length - 1 ? STEPS[idx + 1] : null;

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-950/90 px-6 py-2.5 backdrop-blur">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm font-semibold tracking-wide text-neutral-100">
          Recut
        </Link>
        <nav className="flex items-center gap-1">
          {STEPS.map((s, i) => {
            const active = s.slug === current;
            return (
              <Link
                key={s.slug}
                href={s.path}
                data-testid={`nav-${s.slug}`}
                className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                  active ? 'bg-sky-500/15 text-sky-200' : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
                }`}
              >
                <span className={`grid h-4 w-4 place-items-center rounded-full text-[10px] tabular-nums ${active ? 'bg-sky-400 text-black' : 'bg-neutral-800 text-neutral-400'}`}>
                  {i + 1}
                </span>
                {s.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {next && (
        <Link
          href={next.path}
          data-testid="nav-next"
          className="shrink-0 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-sky-400"
        >
          Next: {next.label} →
        </Link>
      )}
    </header>
  );
}
