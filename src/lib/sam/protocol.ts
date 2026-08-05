import type { SamImageInput } from "./types";

export type SamWorkerRequest =
  | { id: string; type: "init" }
  | { id: string; type: "setImage"; image: SamImageInput }
  | { id: string; type: "segment"; x: number; y: number };

export type SamWorkerResponse =
  | { id: string; type: "result"; payload: unknown }
  | { id: string; type: "error"; name: string; message: string };
