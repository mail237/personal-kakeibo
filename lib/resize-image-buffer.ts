import sharp from "sharp";

/** Gemini 送信前の長辺上限（px） */
const MAX_LONG_EDGE_PX = 1200;

/**
 * サーバー側で画像を長辺 MAX_LONG_EDGE_PX 以下に収めて JPEG 化する（クライアントを経由しない API 呼び出しにも対応）。
 * @param fallbackMime sharp が失敗したときに返す MIME（元ファイルの type）
 */
export async function resizeImageBufferForGemini(
  input: Buffer,
  fallbackMime: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const out = await sharp(input)
      .rotate()
      .resize({
        width: MAX_LONG_EDGE_PX,
        height: MAX_LONG_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { buffer: out, mimeType: "image/jpeg" };
  } catch {
    return { buffer: input, mimeType: fallbackMime || "image/jpeg" };
  }
}
