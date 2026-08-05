import React, { useState, useRef, useEffect } from "react";
import { Upload, AlertCircle, Image as ImageIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { fileToLoadedImage, isImageFile } from "@/lib/sam/imageLoader";
import type { LoadedImage } from "@/hooks";

export interface ImageDropzoneProps {
  onImageLoaded: (image: LoadedImage) => void;
}

export function ImageDropzone({ onImageLoaded }: ImageDropzoneProps) {
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef<number>(0);

  useEffect(() => {
    // ref オブジェクト自体は不変なのでローカルに退避してから cleanup で使う。
    // 直接 generationRef.current を触ると exhaustive-deps が「cleanup 実行時には
    // 値が変わっている」と警告するが、ここで欲しいのは実行時点の最新値そのもの。
    const generation = generationRef;
    return () => {
      // アンマウント後に解決したデコード結果を stale にして通知させない。
      generation.current++;
    };
  }, []);

  const handleFile = async (file: File) => {
    const currentGen = ++generationRef.current;
    setError(null);
    if (!isImageFile(file)) {
      setError("画像ファイルを選択してください。");
      return;
    }

    try {
      const loadedImage = await fileToLoadedImage(file);
      if (currentGen === generationRef.current) {
        onImageLoaded(loadedImage);
      } else {
        if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(loadedImage.objectUrl);
        }
      }
    } catch (err) {
      if (currentGen === generationRef.current) {
        setError(err instanceof Error ? err.message : "画像の読み込みに失敗しました。");
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      // 同じファイルを再選択してもブラウザが change を発火できるよう、
      // 非同期処理（handleFile）を始める前に同期的に value をクリアする。
      e.currentTarget.value = "";
      void handleFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      void handleFile(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  return (
    <div className="space-y-4">
      <Card
        className={`border-2 border-dashed transition-colors ${
          isDragOver ? "border-primary bg-primary/5" : "border-border"
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <CardContent className="flex flex-col items-center justify-center p-8 text-center">
          <div className="mb-4 rounded-full bg-secondary p-3 text-secondary-foreground">
            <Upload className="size-8" />
          </div>
          <h3 className="mb-1 font-semibold text-foreground">画像をアップロード</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            ドラッグ＆ドロップするか、ファイルを選択してください
          </p>

          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            data-testid="file-input"
            id="image-file-input"
          />

          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <ImageIcon className="mr-2 size-4" />
            画像を選択
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>エラー</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
