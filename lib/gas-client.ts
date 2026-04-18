import type { AnalysisResult, RecentEntry } from "./types";

function getGasConfig() {
  const url = process.env.GAS_WEBAPP_URL?.trim();
  const secret = process.env.GAS_SHARED_SECRET?.trim();
  if (!url) throw new Error("GAS_WEBAPP_URL が設定されていません。");
  if (!secret) throw new Error("GAS_SHARED_SECRET が設定されていません。");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(
      "GAS_WEBAPP_URL がURLではありません。Vercel の環境変数に「https://script.google.com/macros/s/.../exec」を貼ってください（スプレッドシートIDを貼っていないか確認）。"
    );
  }
  try {
    new URL(url);
  } catch {
    throw new Error(
      "GAS_WEBAPP_URL が無効です。Apps Script の「デプロイを管理」に表示されるウェブアプリのURLをそのまま貼り直してください。"
    );
  }
  return { url, secret };
}

async function gasPost<T>(payload: unknown): Promise<T> {
  const { url, secret } = getGasConfig();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ secret, ...(payload as object) }),
    cache: "no-store",
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`GAS 応答がJSONではありません (HTTP ${res.status})`);
  }

  if (!json || typeof json !== "object") {
    throw new Error(`GAS 応答が不正です (HTTP ${res.status})`);
  }
  const obj = json as Record<string, unknown>;

  if (!res.ok || obj.ok === false) {
    const msg =
      (typeof obj.error === "string" && obj.error) ||
      `GAS エラー (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return obj as unknown as T;
}

export async function gasAppend(
  analysis: AnalysisResult
): Promise<{ deduped: boolean }> {
  const res = await gasPost<{ ok: true; deduped?: boolean }>({
    action: "append",
    analysis,
  });
  return { deduped: res.deduped === true };
}

export type GasRecentResult = {
  entries: RecentEntry[];
  /** スプレッドシートに存在しなかったタブ名（日本語・完全一致） */
  missingTabs: string[];
  /** 1行目だけ（データ行なし）のタブ名 */
  headerOnlyTabs: string[];
};

export async function gasRecent(limitPerSheet = 6): Promise<GasRecentResult> {
  const res = await gasPost<{
    ok: true;
    entries: RecentEntry[];
    missingTabs?: string[];
    headerOnlyTabs?: string[];
  }>({
    action: "recent",
    limitPerSheet,
  });
  return {
    entries: res.entries ?? [],
    missingTabs: res.missingTabs ?? [],
    headerOnlyTabs: res.headerOnlyTabs ?? [],
  };
}

