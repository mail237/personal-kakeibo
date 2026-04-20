import { NextRequest, NextResponse } from "next/server";
import { postprocessKakeiboForSave } from "@/lib/analysis-postprocess";
import { resizeImageBufferForGemini } from "@/lib/resize-image-buffer";
import {
  analyzeImage,
  analyzeText,
  friendlyGeminiErrorMessage,
} from "@/lib/gemini-analyze";
import type { InputMode } from "@/lib/types";

export const dynamic = "force-dynamic";
/** Gemini＋画像は数秒〜数十秒。Hobby も含め多くの環境で上限に近いため 60 秒設定（画像は短タイムアウトで複数モデル試行） */
export const maxDuration = 60;
export const runtime = "nodejs";

const MODES: InputMode[] = ["auto", "kakeibo", "medical", "juku", "pet", "log"];

/** Vercel のリクエスト上限付近で落ちるのを防ぐ（base64 前のバイナリ長） */
const MAX_IMAGE_BYTES = 3_200_000;

export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Content-Type は multipart/form-data にしてください。" },
        { status: 400 }
      );
    }

    const form = await req.formData();
    const modeRaw = String(form.get("mode") || "auto");
    if (!MODES.includes(modeRaw as InputMode)) {
      return NextResponse.json({ error: "mode が不正です。" }, { status: 400 });
    }
    const mode = modeRaw as InputMode;
    const text = String(form.get("text") || "");
    const file = form.get("image");

    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          {
            error: `画像が大きすぎます（${Math.round(file.size / 1_000_000)}MB）。${Math.round(MAX_IMAGE_BYTES / 1_000_000)}MB 以下に縮小するか、画質を下げてから送ってください。`,
          },
          { status: 413 }
        );
      }
      const rawBuf = Buffer.from(await file.arrayBuffer());
      const { buffer: buf, mimeType: mime } = await resizeImageBufferForGemini(
        rawBuf,
        file.type || "image/jpeg"
      );
      const base64 = buf.toString("base64");
      const analysis = await analyzeImage(mode, base64, mime, text);
      return NextResponse.json({
        ok: true,
        analysis: postprocessKakeiboForSave(analysis, {
          sourceText: text,
          analyzedWithImage: true,
        }),
      });
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "テキストまたは画像のどちらかが必要です。" },
        { status: 400 }
      );
    }

    const analysis = await analyzeText(mode, text);
    return NextResponse.json({
      ok: true,
      analysis: postprocessKakeiboForSave(analysis, {
        sourceText: text,
        analyzedWithImage: false,
      }),
    });
  } catch (e) {
    const msg = friendlyGeminiErrorMessage(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
