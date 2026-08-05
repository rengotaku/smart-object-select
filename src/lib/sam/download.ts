import type { RgbaPixels } from "./exportImage";

export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;

export interface ClipboardLike {
  write(items: ClipboardItem[]): Promise<void>;
}

function defaultCreateCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** RGBA を PNG Blob にする。canvas 生成は差し替え可能（jsdom 対策） */
export function pixelsToPngBlob(
  pixels: RgbaPixels,
  createCanvas: CanvasFactory = defaultCreateCanvas
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = createCanvas(pixels.width, pixels.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Failed to get 2d context for PNG export."));
      return;
    }

    const imageData = ctx.createImageData(pixels.width, pixels.height);
    imageData.data.set(pixels.data);
    ctx.putImageData(imageData, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode PNG blob."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

/**
 * Blob をダウンロードさせる。document は差し替え可能
 *
 * `URL.revokeObjectURL` は `click()` と同じ同期処理内では呼ばない。Firefox 等
 * ダウンロードが非同期に開始されるブラウザでは、読み込み前に URL が無効化され
 * ファイルが保存されないため（クリック後・次タスク以降に解放する）。
 */
export function triggerDownload(
  blob: Blob,
  filename: string,
  doc: Document = document
): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = doc.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } catch (err) {
    // クリックまで到達できなければダウンロードは始まらないので、遅延解放を待たず
    // ここで解放する（待つと解放されないまま Blob が残る）。
    URL.revokeObjectURL(url);
    throw err;
  }

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * 画像 Blob をクリップボードへ書き込む。非対応・拒否時は Error で reject する
 * （握りつぶさない）。
 *
 * jsdom には `ClipboardItem` が存在しないため、実在する場合のみ本物を構築し、
 * 存在しない環境（テストで fake clipboard を注入する場合）は duck-typed な
 * オブジェクトで代替する。`ClipboardItem` 不在による ReferenceError は起きない。
 */
export function copyImageToClipboard(
  blob: Blob,
  clipboard?: ClipboardLike
): Promise<void> {
  const target: ClipboardLike | undefined =
    clipboard ??
    (typeof navigator !== "undefined"
      ? (navigator.clipboard as unknown as ClipboardLike | undefined)
      : undefined);

  if (!target || typeof target.write !== "function") {
    return Promise.reject(
      new Error(
        "Clipboard API is not supported in this environment. Copy to clipboard is unavailable."
      )
    );
  }

  const mimeType = blob.type || "image/png";
  const item: ClipboardItem =
    typeof ClipboardItem === "undefined"
      ? ({ [mimeType]: blob } as unknown as ClipboardItem)
      : new ClipboardItem({ [mimeType]: blob });

  return target.write([item]).catch((err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
  });
}

// eslint-disable-next-line no-control-regex -- 制御文字（0x00-0x1f）を明示的に除去する
const UNSAFE_FILENAME_CHARS = /[\x00-\x1f<>:"/\\|?*]/g;

function sanitizeBaseName(sourceName?: string): string {
  if (!sourceName) return "";

  const withoutDir = sourceName.replace(/^.*[/\\]/, "");
  const withoutExtension = withoutDir.replace(/\.[^./\\]+$/, "");
  return withoutExtension.replace(UNSAFE_FILENAME_CHARS, "").trim();
}

/** 書き出しファイル名を組み立てる */
export function buildExportFilename(
  kind: "cutout" | "mask",
  sourceName?: string
): string {
  const base = sanitizeBaseName(sourceName);
  return base
    ? `smart-object-select-${kind}-${base}.png`
    : `smart-object-select-${kind}.png`;
}
