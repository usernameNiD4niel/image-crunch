const ENTRIES = [
  {
    n: "01",
    title: "Nothing leaves your browser",
    body: "Image Crunch has no server. Raster files are decoded, resized and re-encoded by your own device; SVG and icons pass through unchanged. The results never travel anywhere. Close the tab and nothing remains — there is no account, no history, and nothing stored.",
  },
  {
    n: "02",
    title: "Which format should you use",
    body: "WebP is smaller than both JPG and PNG at matched quality and is supported everywhere that matters. Choose JPG for photographs headed somewhere old. Choose PNG when you need transparency or crisp flat colour — screenshots, logos, diagrams.",
  },
  {
    n: "03",
    title: "What quality actually changes",
    body: "Quality controls how much detail the encoder discards, not the pixel dimensions. Above 80 the loss is usually invisible; below 50 it is obvious in gradients and flat areas first. Use the comparison view before trusting a number.",
  },
];

export function Editorial() {
  return (
    <section className="mx-auto max-w-[1440px] px-6">
      {ENTRIES.map((entry) => (
        <article key={entry.n} className="grid grid-cols-1 gap-4 border-t border-rule py-10 md:grid-cols-12">
          <span className="data md:col-span-1 text-ink-38">{entry.n}</span>
          <h2 className="md:col-span-4 text-[2.25rem] leading-tight tracking-[-0.02em]">{entry.title}</h2>
          <p className="md:col-span-6 md:col-start-7 max-w-[62ch] text-ink-60">{entry.body}</p>
        </article>
      ))}

      <footer className="data border-t border-rule py-8 text-[0.8125rem] text-ink-38">
        IMAGE CRUNCH · 2026 · DANIEL REY · TYPE: ARCHIVO / JETBRAINS MONO
      </footer>
    </section>
  );
}
