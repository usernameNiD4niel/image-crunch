const NotFound = () => (
  <main className="mx-auto flex min-h-dvh max-w-[1440px] flex-col justify-center px-6">
    <p className="data text-ink-58">404</p>
    <h1 className="display mt-4 -ml-[0.055em]">
      No such
      <br />
      page.
    </h1>
    <p className="mt-8 max-w-[42ch] text-ink-72">
      Nothing lives at this address. The compressor is one link away.
    </p>
    <a
      href="/"
      className="label mt-8 inline-block self-start border border-ink bg-ink px-6 py-3 text-paper transition-colors duration-[140ms] ease-[var(--ease)] hover:bg-paper hover:text-ink"
    >
      ← Image Crunch
    </a>
  </main>
);

export default NotFound;
