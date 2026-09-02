/** A finished cut-out: the source's own pixels, plus an alpha channel. */
export interface MatteResult {
  blob: Blob;
  width: number;
  height: number;
}

export interface MatteRequest {
  type: "matte";
  id: string;
  generation: number;
  // Client-generated, monotonic per MatteClient instance. Unique per
  // dispatch — unlike id+generation, which two matte() calls for the same
  // row can share (see client.ts) — so a reply can be matched back to
  // exactly the request that produced it, regardless of the order in
  // which overlapping requests actually finish in the worker.
  seq: number;
  file: File;
}

export type MatteResponse =
  | { type: "done"; id: string; generation: number; seq: number; result: MatteResult }
  | { type: "error"; id: string; generation: number; seq: number; message: string };
