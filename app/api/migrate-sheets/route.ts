import { NextResponse } from "next/server";
import { gasMigrateLegacyDToE } from "@/lib/gas-client";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { migrated } = await gasMigrateLegacyDToE();
    return NextResponse.json({ ok: true, migrated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "移行に失敗しました。";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
