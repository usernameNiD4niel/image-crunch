export function Statement() {
  return (
    <section className="mx-auto grid min-h-[calc(100dvh-3rem)] max-w-[1440px] grid-cols-1 content-center gap-12 px-6 pt-12 md:grid-cols-12">
      <div className="md:col-span-8">
        <h1 className="display">
          Smaller
          <br />
          files.
          <br />
          Same
          <br />
          picture.
        </h1>

        <a
          href="#tool"
          className="mt-10 inline-block bg-signal px-6 py-3 text-signal-ink transition-opacity duration-[140ms] ease-[var(--ease)] hover:opacity-90"
        >
          <span className="label">Start ↓</span>
        </a>
      </div>

      <aside className="self-end md:col-span-4 md:col-start-9">
        <ul className="label space-y-1 text-ink-60">
          <li>Free</li>
          <li>No account</li>
          <li>On-device</li>
        </ul>
        <p className="mt-6 max-w-[42ch] text-ink-60">
          Every byte is processed in your own browser. Nothing is uploaded, ever.
        </p>
      </aside>
    </section>
  );
}
