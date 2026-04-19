"use client";

import { useCallback, useEffect, useState } from "react";
import { shrinkImageFileForUpload } from "@/lib/shrink-image-for-upload";
import type { AnalysisResult, InputMode, RecentEntry } from "@/lib/types";

const TABS: { mode: InputMode; label: string }[] = [
  { mode: "auto", label: "自動判定" },
  { mode: "kakeibo", label: "家計簿" },
  { mode: "medical", label: "医療" },
  { mode: "juku", label: "塾関係" },
  { mode: "pet", label: "ペット記録" },
  { mode: "log", label: "行動ログ" },
];

function categoryLabel(c: AnalysisResult["category"]): string {
  if (c === "kakeibo") return "家計簿";
  if (c === "pet") return "ペット記録";
  return "行動ログ";
}

/** 直近一覧: 行動ログの C は時間。家計簿・医療・塾・ペットの C は金額 */
function formatRecentSubline(e: RecentEntry): string {
  const cells = Array.isArray(e.cells) ? e.cells : [];
  const parts = [cells[1] ?? ""].filter(Boolean);
  const c = cells[2] ?? "";
  if (e.sheet === "log") {
    if (c !== "") parts.push(String(c));
  } else if (c !== "") {
    const n = Number(String(c).replace(/,/g, ""));
    parts.push(Number.isFinite(n) && n !== 0 ? `¥${n}` : String(c));
  }
  const d = cells[3];
  if (d) parts.push(String(d));
  return parts.join(" · ");
}

/** プレビュー用：家計簿でも詳細カテゴリ（塾関係・医療など）をバッジに出す */
function previewBadgeLabel(a: AnalysisResult): string {
  if (a.category === "kakeibo") {
    const sub = a.fields?.category;
    if (typeof sub === "string" && sub.trim()) return sub.trim();
    return "家計簿";
  }
  return categoryLabel(a.category);
}

export default function RecordApp() {
  const [mode, setMode] = useState<InputMode>("auto");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"analyze" | "save" | null>(null);
  const [entries, setEntries] = useState<RecentEntry[]>([]);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [recordsEmptyHint, setRecordsEmptyHint] = useState<string | null>(null);
  const [recordsBusy, setRecordsBusy] = useState(false);
  /** 解析中に経過秒を出す（待ち時間が長いとフリーズに見えるため） */
  const [analyzeElapsedSec, setAnalyzeElapsedSec] = useState(0);

  useEffect(() => {
    if (busy !== "analyze") {
      setAnalyzeElapsedSec(0);
      return;
    }
    setAnalyzeElapsedSec(0);
    const id = window.setInterval(() => {
      setAnalyzeElapsedSec((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  const loadRecords = useCallback(async () => {
    setRecordsBusy(true);
    try {
      const res = await fetch(`/api/records?_=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "取得に失敗しました");
      setRecordsError(null);
      const list = (data.entries ?? []) as RecentEntry[];
      setEntries(list);
      const missing: string[] = data.missingTabs ?? [];
      const headerOnly: string[] = data.headerOnlyTabs ?? [];
      if (list.length === 0) {
        if (missing.length > 0) {
          setRecordsEmptyHint(
            `スプレッドシートに次のタブがありません（名前の完全一致が必要です）: ${missing.join("、")}`
          );
        } else if (headerOnly.length > 0) {
          setRecordsEmptyHint(
            `次のタブには2行目以降のデータがありません（見出しだけ）: ${headerOnly.join("、")}`
          );
        } else {
          setRecordsEmptyHint(
            "データ行はありますが、A〜Dがすべて空の行だけの可能性があります。日付・概要などを1列目以降に入れた行があるか確認してください。"
          );
        }
      } else {
        setRecordsEmptyHint(null);
      }
    } catch (e) {
      setEntries([]);
      setRecordsEmptyHint(null);
      setRecordsError(
        e instanceof Error ? e.message : "直近の記録の取得に失敗しました。"
      );
    } finally {
      setRecordsBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  async function onAnalyze() {
    setError(null);
    setNotice(null);
    setRecordsError(null);
    setRecordsEmptyHint(null);
    setPreview(null);
    if (!text.trim() && !file) {
      setError("テキストを入力するか、画像を選んでください。");
      return;
    }
    setBusy("analyze");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 120_000);
    try {
      let imageToSend: File | null = file;
      if (file) {
        imageToSend = await shrinkImageFileForUpload(file);
      }
      const fd = new FormData();
      fd.set("mode", mode);
      fd.set("text", text);
      if (imageToSend) fd.set("image", imageToSend);
      const res = await fetch("/api/analyze", {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });
      let data: { error?: string; analysis?: AnalysisResult } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        throw new Error(
          res.status === 504 || res.status === 502
            ? "サーバー側の制限時間までに終わりませんでした（写真の解析は混雑時に遅くなります）。あとでもう一度試すか、テキスト欄に店名・金額だけ書いて解析すると通りやすいです。"
            : "サーバーからの応答を読み取れませんでした。"
        );
      }
      if (!res.ok) throw new Error(data.error || "解析に失敗しました");
      setPreview(data.analysis as AnalysisResult);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError(
          "解析が2分以内に終わりませんでした。電波を確認するか、あとでもう一度お試しください。"
        );
      } else if (e instanceof TypeError) {
        setError(
          "通信に失敗しました。電波・Wi-Fi を確認するか、しばらくしてから再度お試しください。"
        );
      } else {
        setError(e instanceof Error ? e.message : "エラーが発生しました");
      }
    } finally {
      window.clearTimeout(timeoutId);
      setBusy(null);
    }
  }

  async function onSave() {
    if (!preview) return;
    setError(null);
    setNotice(null);
    setRecordsError(null);
    setRecordsEmptyHint(null);
    setBusy("save");
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis: preview }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存に失敗しました");
      if (data.deduped === true) {
        setNotice("直前の行と同じ内容のため、重複追加はしませんでした。");
      }
      setPreview(null);
      setText("");
      setFile(null);
      await loadRecords();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-4 pb-28 pt-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          記録ノート
        </h1>
        <p className="text-sm text-zinc-500">
          テキストや写真を送ると AI が分類します。確認してから保存します。
        </p>
      </header>

      <section className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
          記録の種類
        </p>
        <div className="grid grid-cols-2 gap-2">
          {TABS.map((t) => (
            <button
              key={t.mode}
              type="button"
              onClick={() => setMode(t.mode)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                mode === t.mode
                  ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-zinc-700">
          テキスト
        </label>
        <textarea
          className="min-h-[120px] w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-2"
          placeholder="例：塾の月謝 12000円 / 病院 3000円 / コンビニ 580円"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <label className="block text-sm font-medium text-zinc-700">
          画像（レシート・領収書）
        </label>
        <p className="text-xs text-zinc-500">
          撮影したままで大丈夫です。送る直前にこの端末の中だけで自動的に縮小します（レシートの文字も読み取りやすいサイズに調整）。
        </p>
        <input
          type="file"
          accept="image/*"
          className="w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => void onAnalyze()}
          disabled={busy !== null}
          aria-busy={busy === "analyze"}
          className="mt-2 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === "analyze" ? (
            <span className="inline-flex w-full items-center justify-center gap-2">
              <span
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent"
                aria-hidden
              />
              <span>
                解析中…
                {analyzeElapsedSec > 0
                  ? `（${analyzeElapsedSec}秒）`
                  : ""}
              </span>
            </span>
          ) : (
            "AI で解析"
          )}
        </button>
        {busy === "analyze" && (
          <p className="text-center text-xs leading-relaxed text-zinc-500">
            サーバーで AI が処理しています。混雑時は{" "}
            <span className="font-medium text-zinc-600">1分前後</span>
            かかることがあります。
          </p>
        )}
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {notice}
        </div>
      )}

      {preview && (
        <section className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
              {previewBadgeLabel(preview)}
            </span>
            <span className="text-xs text-zinc-500">{preview.date}</span>
          </div>
          <p className="text-sm font-medium text-zinc-900">{preview.summary}</p>
          {typeof preview.fields.bikou === "string" &&
            preview.fields.bikou.trim() !== "" && (
              <p className="text-sm leading-relaxed text-zinc-600">
                <span className="font-medium text-zinc-500">備考</span>{" "}
                {preview.fields.bikou}
              </p>
            )}
          <pre className="max-h-48 overflow-auto rounded-lg bg-white/80 p-3 text-xs text-zinc-700 ring-1 ring-emerald-100">
            {JSON.stringify(preview.fields, null, 2)}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={busy !== null}
              className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === "save" ? "保存中…" : "スプレッドシートに保存"}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700"
            >
              破棄
            </button>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-zinc-800">直近の記録</h2>
          <button
            type="button"
            onClick={() => void loadRecords()}
            disabled={recordsBusy}
            className="shrink-0 rounded-lg border border-emerald-600 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900 shadow-sm hover:bg-emerald-100 disabled:opacity-50"
          >
            {recordsBusy ? "取得中…" : "一覧を更新"}
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          一覧は画面の一番下です。入力欄や「AI で解析」の下までスクロールしてください。
        </p>
        {recordsError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            直近の記録: {recordsError}
          </div>
        )}
        {recordsEmptyHint && !recordsError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {recordsEmptyHint}
          </div>
        )}
        <ul className="space-y-2">
          {entries.length === 0 && !recordsError && (
            <li className="rounded-xl border border-dashed border-zinc-200 px-3 py-6 text-center text-sm text-zinc-400">
              まだ記録がありません
            </li>
          )}
          {entries.map((e, i) => (
            <li
              key={`${e.label}-${i}-${(e.cells ?? [])[0] ?? i}`}
              className="rounded-xl border border-zinc-100 bg-white px-3 py-2 text-sm shadow-sm"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-emerald-700">
                  {e.label}
                </span>
                <span className="text-xs text-zinc-400">
                  {(e.cells ?? [])[0] ?? ""}
                </span>
              </div>
              <p className="line-clamp-2 text-zinc-700">
                {formatRecentSubline(e)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
