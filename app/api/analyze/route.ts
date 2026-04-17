import { NextRequest, NextResponse } from "next/server";
import { analyzeImage, analyzeText } from "@/lib/gemini-analyze";
import type { InputMode } from "@/lib/types";

export const dynamic = "force-dynamic";

const MODES: InputMode[] = ["auto", "kakeibo", "pet", "log"];

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
      const buf = Buffer.from(await file.arrayBuffer());
      const base64 = buf.toString("base64");
      const mime = file.type || "image/jpeg";
      const analysis = await analyzeImage(mode, base64, mime, text);
      return NextResponse.json({ ok: true, analysis });
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "テキストまたは画像のどちらかが必要です。" },
        { status: 400 }
      );
    }

    const analysis = await analyzeText(mode, text);
    return NextResponse.json({ ok: true, analysis });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "解析に失敗しました。";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
