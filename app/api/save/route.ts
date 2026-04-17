import { NextRequest, NextResponse } from "next/server";
import { gasAppend } from "@/lib/gas-client";
import type { AnalysisResult } from "@/lib/types";

export const dynamic = "force-dynamic";

function isValidAnalysis(body: unknown): body is AnalysisResult {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  const cat = o.category;
  if (cat !== "kakeibo" && cat !== "pet" && cat !== "log") return false;
  if (typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date))
    return false;
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
    await gasAppend(analysis);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存に失敗しました。";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
