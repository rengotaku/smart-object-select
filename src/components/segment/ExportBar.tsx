import { useState } from "react";
import { AlertTriangle, ClipboardCopy, Download, ImageDown, Loader2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  applyMaskToImage,
  maskToBlackAndWhite,
  type RgbaPixels,
} from "@/lib/sam/exportImage";
import {
  buildExportFilename,
  copyImageToClipboard as defaultCopyImageToClipboard,
  pixelsToPngBlob as defaultPixelsToPngBlob,
  triggerDownload,
} from "@/lib/sam/download";
import type { SamImageInput, SamMaskResult } from "@/lib/sam";

export interface ExportBarProps {
  image: SamImageInput | null;
  mask: SamMaskResult | null;
  /** 元ファイル名（拡張子込み）。書き出しファイル名の生成に使う。省略時は既定名を使う */
  sourceFileName?: string;
  /**
   * RGBA を PNG Blob に変換する関数。テストから実 canvas を叩かずに差し替えられるよう
   * DI で受け取る（既定は `pixelsToPngBlob`）。
   */
  exportPng?: (pixels: RgbaPixels) => Promise<Blob>;
  /** Blob をダウンロードさせる関数（既定は `triggerDownload`） */
  saveFile?: (blob: Blob, filename: string) => void;
  /** Blob をクリップボードへコピーする関数（既定は `copyImageToClipboard`） */
  copyToClipboard?: (blob: Blob) => Promise<void>;
}

type ExportKind = "cutout" | "mask" | "clipboard";

export function ExportBar({
  image,
  mask,
  sourceFileName,
  exportPng = (pixels) => defaultPixelsToPngBlob(pixels),
  saveFile = (blob, filename) => triggerDownload(blob, filename),
  copyToClipboard = (blob) => defaultCopyImageToClipboard(blob),
}: ExportBarProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ExportKind | null>(null);

  const disabled = !image || !mask;

  const runExport = async (kind: ExportKind, action: () => Promise<void>) => {
    if (disabled) return;
    setError(null);
    setPending(kind);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "書き出しに失敗しました。");
    } finally {
      setPending(null);
    }
  };

  const handleDownloadCutout = () =>
    runExport("cutout", async () => {
      const pixels = applyMaskToImage(image!, mask!);
      const blob = await exportPng(pixels);
      saveFile(blob, buildExportFilename("cutout", sourceFileName));
    });

  const handleDownloadMask = () =>
    runExport("mask", async () => {
      const pixels = maskToBlackAndWhite(mask!);
      const blob = await exportPng(pixels);
      saveFile(blob, buildExportFilename("mask", sourceFileName));
    });

  const handleCopyToClipboard = () =>
    runExport("clipboard", async () => {
      const pixels = applyMaskToImage(image!, mask!);
      const blob = await exportPng(pixels);
      await copyToClipboard(blob);
    });

  const isBusy = pending !== null;

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <h2 className="text-sm font-semibold text-foreground">書き出し</h2>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled || isBusy}
          onClick={() => void handleDownloadCutout()}
        >
          {pending === "cutout" ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ImageDown className="mr-2 size-4" aria-hidden="true" />
          )}
          透過切り抜き PNG
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || isBusy}
          onClick={() => void handleDownloadMask()}
        >
          {pending === "mask" ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="mr-2 size-4" aria-hidden="true" />
          )}
          マスク画像 (白黒)
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || isBusy}
          onClick={() => void handleCopyToClipboard()}
        >
          {pending === "clipboard" ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ClipboardCopy className="mr-2 size-4" aria-hidden="true" />
          )}
          クリップボードへコピー
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>書き出しエラー</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
