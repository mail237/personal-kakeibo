import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 本番が想定コミットか確認する用（Vercel 環境変数） */
export async function GET() {
  return NextResponse.json({
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  });
}
