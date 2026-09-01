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
  file: File;
}

export type MatteResponse =
  | { type: "done"; id: string; generation: number; result: MatteResult }
  | { type: "error"; id: string; generation: number; message: string };
