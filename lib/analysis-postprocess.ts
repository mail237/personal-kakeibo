import type { AnalysisResult } from "./types";

/** 日本時間の今日 YYYY-MM-DD */
function jstYmdToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** 日付が無い・形式が違うときは当日（サーバー処理日・日本時間基準） */
function ensureAnalysisDate(r: AnalysisResult): AnalysisResult {
  const d = String(r.date ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return r;
  return { ...r, date: jstYmdToday() };
}

/** 「1/3錠」「1/2回」などを日付 m/d と誤認しないよう除く */
function stripDosageLikeSlashPatterns(text: string): string {
  return text.replace(
    /\d{1,2}\s*\/\s*\d{1,2}\s*(?:錠|錢|回|mg|ｍｇ|ML|ml|枚|滴|割|カップ|包|錠剤)/gi,
    " "
  );
}

/** m/d がカレンダーっぽいか（1/2・1/3 等は用量として除外） */
function slashPairLooksLikeMonthDay(a: number, b: number): boolean {
  if (a < 1 || a > 12 || b < 1 || b > 31) return false;
  if (a <= 2 && b <= 3) return false;
  return true;
}

function textHasSlashMonthDay(text: string): boolean {
  const re = /(?:^|[^\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?:[^\d]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const mo = parseInt(m[1], 10);
    const da = parseInt(m[2], 10);
    if (slashPairLooksLikeMonthDay(mo, da)) return true;
  }
  return false;
}

/** summary・fields に「その日付」が書かれていないのに date だけ変な年になるのを防ぐ */
function textSuggestsCalendarOrRelativeDate(text: string): boolean {
  const t = stripDosageLikeSlashPatterns(text).trim();
  if (!t) return false;
  if (/\d{4}\s*[-／/]\s*\d{1,2}\s*[-／/]\s*\d{1,2}/.test(t)) return true;
  if (/\d{4}年\s*\d{1,2}月\s*\d{1,2}日/.test(t)) return true;
  if (/\d{1,2}\s*月\s*\d{1,2}\s*日/.test(t)) return true;
  if (textHasSlashMonthDay(t)) return true;
  if (/今日|本日|昨日|一昨日|明日|先日|先週|今週|来週|あさって|おととい/.test(t)) {
    return true;
  }
  return false;
}

export type PostprocessOptions = {
  /** ユーザーがフォームに打った原文。日付が無ければ当日固定（AI の date を信じない） */
  sourceText?: string;
  /** 画像つき解析。家計簿はレシート日付を残すためメモだけでは上書きしない */
  analyzedWithImage?: boolean;
};

/**
 * ユーザー入力に日付が無いとき AI が入れた date（例: 2024-05-15）を捨てて当日にする。
 * テキストのみならカテゴリ問わず適用。画像＋家計簿だけはレシート日付を残す。
 */
function resolveAnalysisDateFromUser(
  r: AnalysisResult,
  opts?: PostprocessOptions
): AnalysisResult {
  const userSrc = opts?.sourceText?.trim() ?? "";
  const withImage = opts?.analyzedWithImage === true;
  const userHasCalendarHint =
    userSrc.length > 0 && textSuggestsCalendarOrRelativeDate(userSrc);

  if (!withImage && userSrc.length > 0 && !userHasCalendarHint) {
    return { ...r, date: jstYmdToday() };
  }

  if (withImage && userSrc.length > 0 && !userHasCalendarHint) {
    if (r.category === "kakeibo") {
      return r;
    }
    return { ...r, date: jstYmdToday() };
  }

  if (r.category === "log" && userSrc.length === 0) {
    const bucket = [
      r.summary,
      ...Object.values(r.fields).map((v) => (v == null ? "" : String(v))),
    ].join("\n");
    const d = String(r.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return { ...r, date: jstYmdToday() };
    }
    if (bucket.includes(d)) return r;
    if (textSuggestsCalendarOrRelativeDate(bucket)) return r;
    return { ...r, date: jstYmdToday() };
  }

  return r;
}

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

/** 請求書 JSON の total_amount（モデルが本文に含めたとき） */
function extractTotalAmountFromJsonSnippet(text: string): number | null {
  const m = text.match(/["']?total_amount["']?\s*:\s*(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** summary の「1,580円」「1580円」「合計1,580円」などから円を推定 */
function extractYenFromJapaneseText(text: string): number | null {
  if (!text) return null;
  const fromJson = extractTotalAmountFromJsonSnippet(text);
  if (fromJson != null) return fromJson;
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

/** ペット記録は GAS が fields.cost のみ参照するため、未設定時は本文から拾う */
function fillPetCostIfMissing(r: AnalysisResult): AnalysisResult {
  if (r.category !== "pet") return r;
  const raw = r.fields.cost;
  const n =
    typeof raw === "number"
      ? raw
      : Number(String(raw ?? "").replace(/,/g, ""));
  if (Number.isFinite(n) && n > 0) return r;
  const amtMisplaced = r.fields.amount;
  const fromAmount =
    typeof amtMisplaced === "number"
      ? amtMisplaced
      : Number(String(amtMisplaced ?? "").replace(/,/g, ""));
  if (Number.isFinite(fromAmount) && fromAmount > 0) {
    return {
      ...r,
      fields: { ...r.fields, cost: fromAmount },
    };
  }
  const content = String(r.fields.content ?? "");
  const hospital = String(r.fields.hospital ?? "");
  const bucket = [r.summary, content, hospital].join("\n");
  const from = extractYenFromJapaneseText(bucket);
  if (from == null) return r;
  return {
    ...r,
    fields: { ...r.fields, cost: from },
  };
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

/** レシート全文のような備考を、店名・要点だけに短くする */
function compressKakeiboBikou(bikou: string): string {
  const lines = bikou
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const skipLine =
    /^\d+\s*円皿|^[（(]?\d+%|小計|合計|外税|内税|伝票|テーブル|登録番号|軽減税率|合計点数|電子マネー|おつり|現金|クレジット|ポイント|^O\d|扱|消費税等|会計|^\(\d+%|\d+\s*[×x]\s*\d+\s*=\s*[\d,，]+\s*円/i;
  const looksLikeAddress =
    /[市区町村]|丁目|番地|号|〒|地下街|^\d+-\d+-\d+|県$/;
  const kept: string[] = [];
  for (const line of lines) {
    if (skipLine.test(line)) continue;
    if (looksLikeAddress.test(line)) continue;
    if (/^[\d,，\s円×=xX（）()%-]+$/i.test(line)) continue;
    kept.push(line);
    if (kept.length >= 2) break;
  }
  let out = kept.join(" ").replace(/\s+/g, " ").trim();
  if (!out) {
    out = (lines[0] ?? "").slice(0, 100);
  }
  if (out.length > 120) {
    out = `${out.slice(0, 117)}…`;
  }
  return out;
}

function shouldCompressKakeiboBikou(b: string): boolean {
  if (/円皿|小計|合計\s*[:：]|外税|伝票|テーブル|登録番号|合計点数/.test(b)) {
    return true;
  }
  const lines = b.split(/\r?\n/).filter((l) => l.trim());
  return b.length > 220 || lines.length > 6;
}

function compressKakeiboBikouField(r: AnalysisResult): AnalysisResult {
  if (r.category !== "kakeibo") return r;
  const b = String(r.fields.bikou ?? "").trim();
  if (!b || !shouldCompressKakeiboBikou(b)) return r;
  return {
    ...r,
    fields: { ...r.fields, bikou: compressKakeiboBikou(b) },
  };
}

/**
 * 解析直後・保存直前のどちらでも使う。
 * 金額は「概要が長いとき」備考へ移す前に拾い、移した後にもう一度拾う（順序バグ防止）。
 * 備考はレシートの羅列を短くする（金額拾いのあと）。
 */
export function postprocessKakeiboForSave(
  r: AnalysisResult,
  opts?: PostprocessOptions
): AnalysisResult {
  const withDate = resolveAnalysisDateFromUser(ensureAnalysisDate(r), opts);
  const afterPet = fillPetCostIfMissing(withDate);
  const afterAmount1 = fillKakeiboAmountIfMissing(afterPet);
  const afterSummary = normalizeKakeiboShortSummary(afterAmount1);
  const afterAmount2 = fillKakeiboAmountIfMissing(afterSummary);
  return compressKakeiboBikouField(afterAmount2);
}
