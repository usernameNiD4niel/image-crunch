import { zip } from "fflate";

export async function bundleZip(entries: { name: string; blob: Blob }[]): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};

  for (const entry of entries) {
    files[entry.name] = new Uint8Array(await entry.blob.arrayBuffer());
  }

  return new Promise<Blob>((resolve, reject) => {
    // level 0: image bytes are already compressed; deflating again wastes time for ~0 gain.
    zip(files, { level: 0 }, (err, data) => {
      if (err) reject(err);
      else resolve(new Blob([data], { type: "application/zip" }));
    });
  });
}
