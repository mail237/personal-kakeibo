import { NextResponse } from "next/server";
import { gasRecent } from "@/lib/gas-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const entries = await gasRecent(6);
    return NextResponse.json({ ok: true, entries });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "取得に失敗しました。";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
