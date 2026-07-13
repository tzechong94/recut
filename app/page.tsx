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
      <div data-testid="harness-status" className="text-xs text-neutral-600">
        harness: replay mode · zero video tokens pre-approval
      </div>
    </main>
  );
}
