"use client";

import { useCallback, useEffect, useState } from "react";
import type { AnalysisResult, InputMode, RecentEntry } from "@/lib/types";

const TABS: { mode: InputMode; label: string }[] = [
  { mode: "auto", label: "自動判定" },
  { mode: "kakeibo", label: "家計簿" },
  { mode: "pet", label: "ペット記録" },
  { mode: "log", label: "行動ログ" },
];

const KAKEIBO_CATEGORIES = [
  "食費",
  "交通費",
  "医療",
  "塾関係",
  "ペット費",
  "日用品",
  "通信",
  "光熱費",
  "住居",
  "交際",
  "娯楽",
  "その他",
] as const;

function categoryLabel(c: AnalysisResult["category"]): string {
  if (c === "kakeibo") return "家計簿";
  if (c === "pet") return "ペット記録";
  return "行動ログ";
}

export default function RecordApp() {
  const [mode, setMode] = useState<InputMode>("auto");
  const [kakeiboCategory, setKakeiboCategory] = useState<string>("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"analyze" | "save" | null>(null);
  const [entries, setEntries] = useState<RecentEntry[]>([]);

  const loadRecords = useCallback(async () => {
    try {
      const res = await fetch("/api/records");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "取得に失敗しました");
      setEntries(data.entries ?? []);
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  async function onAnalyze() {
    setError(null);
    setPreview(null);
    if (!text.trim() && !file) {
      setError("テキストを入力するか、画像を選んでください。");
      return;
    }
    setBusy("analyze");
    try {
      const hint =
        mode === "kakeibo" && kakeiboCategory
          ? `希望カテゴリ: ${kakeiboCategory}\n`
          : "";
      const fd = new FormData();
      fd.set("mode", mode);
      fd.set("text", hint + text);
      if (file) fd.set("image", file);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "解析に失敗しました");
      setPreview(data.analysis as AnalysisResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    if (!preview) return;
    setError(null);
    setBusy("save");
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis: preview }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存に失敗しました");
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
              onClick={() => {
                setMode(t.mode);
                if (t.mode !== "kakeibo") setKakeiboCategory("");
              }}
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
        {mode === "kakeibo" && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              家計簿カテゴリ（任意）
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setKakeiboCategory("")}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  !kakeiboCategory
                    ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                    : "border-zinc-200 bg-white text-zinc-700"
                }`}
              >
                指定なし
              </button>
              {KAKEIBO_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setKakeiboCategory(c)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    kakeiboCategory === c
                      ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                      : "border-zinc-200 bg-white text-zinc-700"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
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
          className="mt-2 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === "analyze" ? "解析中…" : "AI で解析"}
        </button>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {preview && (
        <section className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
              {categoryLabel(preview.category)}
            </span>
            <span className="text-xs text-zinc-500">{preview.date}</span>
          </div>
          <p className="text-sm font-medium text-zinc-900">{preview.summary}</p>
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
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-800">直近の記録</h2>
          <button
            type="button"
            onClick={() => void loadRecords()}
            className="text-xs text-emerald-700 hover:underline"
          >
            更新
          </button>
        </div>
        <ul className="space-y-2">
          {entries.length === 0 && (
            <li className="rounded-xl border border-dashed border-zinc-200 px-3 py-6 text-center text-sm text-zinc-400">
              まだ記録がありません
            </li>
          )}
          {entries.map((e, i) => (
            <li
              key={`${e.label}-${i}-${e.cells[0]}`}
              className="rounded-xl border border-zinc-100 bg-white px-3 py-2 text-sm shadow-sm"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-emerald-700">
                  {e.label}
                </span>
                <span className="text-xs text-zinc-400">{e.cells[0]}</span>
              </div>
              <p className="line-clamp-2 text-zinc-700">
                {e.cells.slice(1).filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
