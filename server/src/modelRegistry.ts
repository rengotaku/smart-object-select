/**
 * サーバーが提供できるモデルの一覧。現時点では `public/models/slimsam-77-uniform/` の
 * 1件のみ（issue #32 のスコープ）。複数モデル対応は sub-issue #33 で拡張する。
 */
export interface ModelDescriptor {
  id: string;
  name: string;
}

export const AVAILABLE_MODELS: ModelDescriptor[] = [
  { id: "slimsam-77-uniform", name: "SlimSAM 77 Uniform" },
];
