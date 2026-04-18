import { NextRequest, NextResponse } from "next/server";
import { postprocessKakeiboForSave } from "@/lib/analysis-postprocess";
import { gasAppend } from "@/lib/gas-client";
import type { AnalysisResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/** date は未記入・形式不正でも可（postprocess で当日に補う） */
function isValidAnalysis(body: unknown): body is AnalysisResult {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  const cat = o.category;
  if (cat !== "kakeibo" && cat !== "pet" && cat !== "log") return false;
  if (o.date != null && typeof o.date !== "string") return false;
  if (!o.fields || typeof o.fields !== "object" || Array.isArray(o.fields))
    return false;
  if (typeof o.summary !== "string") return false;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const json = (await req.json()) as { analysis?: unknown };
    const analysis = json.analysis;
    if (!isValidAnalysis(analysis)) {
      return NextResponse.json(
        { error: "保存データの形式が不正です。" },
        { status: 400 }
      );
    }
    const normalized = postprocessKakeiboForSave(analysis);
    const { deduped } = await gasAppend(normalized);
    return NextResponse.json({ ok: true, deduped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存に失敗しました。";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
