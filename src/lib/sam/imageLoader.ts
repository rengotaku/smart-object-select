import type { LoadedImage } from "@/hooks/useSegmentation";

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function fileToLoadedImage(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    if (!isImageFile(file)) {
      reject(new Error("Selected file is not an image."));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Failed to get 2d context for image decoding");
        }

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height);

        resolve({
          data: imageData.data,
          width,
          height,
          objectUrl,
        });
      } catch (err) {
        if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(objectUrl);
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    img.onerror = () => {
      if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(objectUrl);
      }
      reject(new Error("Failed to load image."));
    };

    img.src = objectUrl;
  });
}
