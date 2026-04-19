/**
 * 撮影した写真をそのまま選べるように、送信前にブラウザ側で縮小・JPEG 化する。
 * API の上限（約 3.2MB）とアップロード時間を抑える。
 */

const TARGET_MAX_BYTES = 2_500_000;
const SKIP_IF_SMALLER_THAN = 650_000;

const LONG_EDGES = [1920, 1600, 1280, 1024, 896] as const;
const JPEG_QUALITIES = [0.88, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4] as const;

function baseNameFromFile(name: string): string {
  const n = name.trim();
  if (!n) return "photo";
  return n.replace(/\.[^./\\]+$/, "") || "photo";
}

async function loadDrawable(
  file: File
): Promise<{ draw: CanvasImageSource; close?: () => void }> {
  try {
    const bitmap = await createImageBitmap(file);
    return {
      draw: bitmap,
      close: () => bitmap.close(),
    };
  } catch {
    /* createImageBitmap が HEIC 等で失敗することがある */
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ draw: img });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像の読み込みに失敗しました。"));
    };
    img.src = url;
  });
}

function intrinsicSize(source: CanvasImageSource): { w: number; h: number } {
  if (source instanceof HTMLImageElement) {
    return { w: source.naturalWidth, h: source.naturalHeight };
  }
  if ("width" in source && "height" in source) {
    return {
      w: (source as { width: number }).width,
      h: (source as { height: number }).height,
    };
  }
  return { w: 0, h: 0 };
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob | null> {
  return new Promise((res) => {
    canvas.toBlob(res, "image/jpeg", quality);
  });
}

function renderToCanvas(
  source: CanvasImageSource,
  maxLongEdge: number
): HTMLCanvasElement {
  const { w: sw, h: sh } = intrinsicSize(source);
  if (sw <= 0 || sh <= 0) {
    throw new Error("画像のサイズが取得できませんでした。");
  }
  let dw = sw;
  let dh = sh;
  const long = Math.max(dw, dh);
  if (long > maxLongEdge) {
    const scale = maxLongEdge / long;
    dw = Math.round(sw * scale);
    dh = Math.round(sh * scale);
  } else {
    dw = Math.round(dw);
    dh = Math.round(dh);
  }

  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像の処理に失敗しました。");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(source, 0, 0, sw, sh, 0, 0, dw, dh);
  return canvas;
}

/**
 * 画像ファイルを API 向けに軽量化する。小さいファイルや非画像はそのまま返す。
 * 失敗時は元の File を返す（呼び出し側でそのまま送信可能）。
 */
export async function shrinkImageFileForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= SKIP_IF_SMALLER_THAN) {
    return file;
  }

  let closer: (() => void) | undefined;
  try {
    const { draw, close } = await loadDrawable(file);
    closer = close;

    for (const edge of LONG_EDGES) {
      const canvas = renderToCanvas(draw, edge);
      for (const q of JPEG_QUALITIES) {
        const blob = await canvasToJpegBlob(canvas, q);
        if (!blob) continue;
        if (blob.size <= TARGET_MAX_BYTES) {
          const name = `${baseNameFromFile(file.name)}.jpg`;
          return new File([blob], name, {
            type: "image/jpeg",
            lastModified: Date.now(),
          });
        }
      }
    }

    const canvas = renderToCanvas(draw, 768);
    const blob = await canvasToJpegBlob(canvas, 0.35);
    if (blob && blob.size > 0) {
      return new File([blob], `${baseNameFromFile(file.name)}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    }
  } catch {
    return file;
  } finally {
    closer?.();
  }

  return file;
}
