import type { AnalysisResult } from "./types";

/** 全角数字 → 半角（１５８０ → 1580） */
function normalizeFullWidthDigits(text: string): string {
  return text.replace(/[\uFF10-\uFF19]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30)
  );
}

/** 全角カンマ・空白を正規化してから金額抽出 */
function normalizeForYenParse(text: string): string {
  return normalizeFullWidthDigits(text)
    .replace(/\u3000/g, " ")
    .replace(/\uFF0C/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

/** summary の「1,580円」「1580円」「合計1,580円」などから円を推定 */
function extractYenFromJapaneseText(text: string): number | null {
  if (!text) return null;
  const raw = normalizeForYenParse(text);
  const compact = raw.replace(/ /g, "");
  const total = /合計\s*[:：]?\s*([\d,]+)\s*円/.exec(compact);
  if (total) {
    const n = Number(total[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const re = /([\d,]+)\s*円/g;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(raw)) !== null) last = m;
  if (!last) {
    const noSpace = /([\d,]+)円/g;
    while ((m = noSpace.exec(compact)) !== null) last = m;
  }
  if (last) {
    const n = Number(last[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  /** カンマなし「1580円」や全角混じりの最終手段 */
  const loose = compact.match(/(\d{2,7})円/g);
  if (loose && loose.length > 0) {
    const mm = loose[loose.length - 1].match(/(\d+)/);
    if (mm) {
      const n = Number(mm[1]);
      if (Number.isFinite(n) && n >= 10 && n <= 9999999) return n;
    }
  }
  return null;
}

function fillKakeiboAmountIfMissing(r: AnalysisResult): AnalysisResult {
  if (r.category !== "kakeibo") return r;
  const raw = r.fields.amount;
  const n =
    typeof raw === "number"
      ? raw
      : Number(String(raw ?? "").replace(/,/g, ""));
  if (Number.isFinite(n) && n > 0) return r;
  const bikou = String(r.fields.bikou ?? "");
  const memo = String(r.fields.memo ?? "");
  const bucket = [r.summary, bikou, memo].join("\n");
  const fromSummary = extractYenFromJapaneseText(r.summary);
  const fromBikou = extractYenFromJapaneseText(bikou);
  const fromMemo = extractYenFromJapaneseText(memo);
  const fromBucket = extractYenFromJapaneseText(bucket);
  const from = fromSummary ?? fromBikou ?? fromMemo ?? fromBucket;
  if (from == null) return r;
  return {
    ...r,
    fields: { ...r.fields, amount: from },
  };
}

/** モデルが全角の ［カフェ］ を返すと半角の正規表現にマッチしないため、括弧だけ正規化する */
function normalizeSummaryBracketsForKakeibo(summary: string): string {
  return summary
    .replace(/\uFF3B/g, "[")
    .replace(/\uFF3D/g, "]");
}

/**
 * 家計簿: 概要は必ず [カテゴリ] のみ。長文は summary から備考へ移す（GAS の normalize と同趣旨）
 */
function normalizeKakeiboShortSummary(r: AnalysisResult): AnalysisResult {
  if (r.category !== "kakeibo") return r;
  const sum = normalizeSummaryBracketsForKakeibo(r.summary.trim());
  const existingBikou = String(r.fields.bikou ?? "").trim();
  const fromBracket = sum.match(/^\[([^\]]+)\]/);
  const catFromField = String(r.fields.category ?? "").trim();

  if (fromBracket) {
    const cat = fromBracket[1].trim() || catFromField;
    const short = `[${cat}]`;
    const rest = sum.replace(/^\[[^\]]+\]\s*/, "").trim();
    if (sum === short) {
      return {
        ...r,
        summary: short,
        fields: {
          ...r.fields,
          category: cat,
        },
      };
    }
    const bikou = [existingBikou, rest].filter(Boolean).join("\n").trim();
    return {
      ...r,
      summary: short,
      fields: { ...r.fields, category: cat, bikou },
    };
  }

  if (!sum) return r;
  const fallbackCat = catFromField || "その他";
  const short = `[${fallbackCat}]`;
  if (sum === short) return r;
  return {
    ...r,
    summary: short,
    fields: {
      ...r.fields,
      category: fallbackCat,
      bikou: [existingBikou, sum].filter(Boolean).join("\n").trim(),
    },
  };
}

/**
 * 解析直後・保存直前のどちらでも使う。
 * 金額は「概要が長いとき」備考へ移す前に拾い、移した後にもう一度拾う（順序バグ防止）。
 */
export function postprocessKakeiboForSave(r: AnalysisResult): AnalysisResult {
  const afterAmount1 = fillKakeiboAmountIfMissing(r);
  const afterSummary = normalizeKakeiboShortSummary(afterAmount1);
  return fillKakeiboAmountIfMissing(afterSummary);
}
