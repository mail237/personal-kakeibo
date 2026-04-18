"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-lg font-semibold text-zinc-900">
        画面の表示に失敗しました
      </h1>
      <p className="mt-2 text-sm text-zinc-600">{error.message}</p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-6 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
      >
        再試行
      </button>
      <p className="mt-4 text-xs text-zinc-500">
        JavaScript をオフにしている・広告ブロックが厳しい場合は、Safari
        以外のブラウザや別端末でも試してください。
      </p>
    </div>
  );
}
