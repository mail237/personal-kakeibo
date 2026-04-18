import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AnalysisCategory, InputMode } from "./types";
import { parseModelJsonText } from "./parse-model-json";
import type { AnalysisResult } from "./types";

/**
 * GEMINI_MODEL を指定しない場合、無料枠やリージョンで使えるモデルが違うため
 * 軽めの Flash 系から順に試す。
 * 手動で固定したいときだけ .env に GEMINI_MODEL=... を書く。
 */
const GEMINI_MODEL_FALLBACKS = [
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  /** 混雑時は別系統の方が通ることがある */
  "gemini-1.5-flash",
] as const;

function shouldTryNextModel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /404|429|503|quota|Quota|not found|NOT_FOUND|RESOURCE_EXHAUSTED|Service Unavailable|high demand|experiencing high demand|overloaded|UNAVAILABLE|try again later/i.test(
    msg
  );
}

function isQuotaOrRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|Too Many Requests|RESOURCE_EXHAUSTED|quota exceeded|exceeded your current quota|generate_content_limit/i.test(
    msg
  );
}

/** API ルート向け: 429 などは画面にそのまま出さない */
export function friendlyGeminiErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (
    isQuotaOrRateLimit(err) ||
    /exceeded your current quota|check your plan and billing|FreeTier|billing details/i.test(raw)
  ) {
    return "Gemini の利用枠に達しました（無料枠の1日あたり上限など）。しばらく待つか、Google AI Studio で課金を有効にするか、別プロジェクトの API キーを試してください。https://aistudio.google.com/";
  }
  if (raw.length > 800) {
    return `${raw.slice(0, 800)}…`;
  }
  return raw;
}

/** エラー本文の "Please retry in 7.08s" や retryDelay を拾う */
function retryAfterMsFromGeminiError(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const sec = msg.match(/retry in ([\d.]+)\s*s/i);
  if (sec) {
    const ms = Math.ceil(parseFloat(sec[1]) * 1000);
    return Math.min(Math.max(ms, 0), 60_000);
  }
  const delay = msg.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (delay) {
    const ms = parseInt(delay[1], 10) * 1000;
    return Math.min(Math.max(ms, 0), 60_000);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withGeminiModelFallback<T>(
  run: (modelId: string) => Promise<T>
): Promise<T> {
  const explicit = process.env.GEMINI_MODEL?.trim();
  /** 明示指定があっても 503 等は次のモデルへ（混雑時の回避） */
  const base = [...GEMINI_MODEL_FALLBACKS];
  const tryOrder: string[] = explicit
    ? [explicit, ...base.filter((id) => id !== explicit)]
    : base;
  let lastErr: unknown;

  /** 全モデル失敗時に少し待ってもう一周（混雑・429 の連続向け） */
  for (let round = 0; round < 3; round++) {
    if (round > 0) {
      await sleep(2800);
    }
    for (const id of tryOrder) {
      try {
        return await run(id);
      } catch (e) {
        lastErr = e;
        if (shouldTryNextModel(e)) {
          const fromApi = retryAfterMsFromGeminiError(e);
          const waitMs =
            fromApi ??
            (isQuotaOrRateLimit(e) ? 3500 : 400);
          await sleep(waitMs);
          continue;
        }
        throw e;
      }
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new Error(String(lastErr));
}

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY が設定されていません。");
  return new GoogleGenerativeAI(key);
}

function modeInstruction(mode: InputMode): string {
  if (mode === "auto") {
    return `次のいずれかに分類してください。
- kakeibo: 支出・収入・レシート・買い物など金銭の記録
- pet: 動物病院・ワクチン・フード・しつけ・体調などペット関連
- log: 作業時間・習慣・日記・TODO 完了など行動・ログ系`;
  }
  if (mode === "medical") {
    return `ユーザーは手動で「医療」を選びました。必ず category は "kakeibo" にし、fields.category は必ず "医療" に固定してください。summary は必ず "[医療]" のみ（短い見出しだけ）。詳細はすべて fields.bikou（備考）に書いてください。`;
  }
  if (mode === "juku") {
    return `ユーザーは手動で「塾関係」を選びました。必ず category は "kakeibo" にし、fields.category は必ず "塾関係" に固定してください。summary は必ず "[塾関係]" のみ（短い見出しだけ）。詳細はすべて fields.bikou（備考）に書いてください。`;
  }
  const map: Record<Exclude<InputMode, "auto" | "medical" | "juku">, AnalysisCategory> = {
    kakeibo: "kakeibo",
    pet: "pet",
    log: "log",
  };
  const labels: Record<Exclude<InputMode, "auto" | "medical" | "juku">, string> = {
    kakeibo: "家計簿",
    pet: "ペット記録",
    log: "行動ログ",
  };
  const fixed = map[mode];
  return `ユーザーは手動で「${labels[mode]}」を選びました。category は必ず "${fixed}" に固定してください。内容が多少ズレていてもこの category を守ってください。`;
}

function buildPrompt(mode: InputMode, userText: string): string {
  return `あなたは個人用の記録アシスタントです。入力を解析し、次の JSON 形だけを返してください（キー名は必ず英語のまま）。

{
  "category": "kakeibo" | "pet" | "log",
  "date": "YYYY-MM-DD（ユーザーが日付を書いていない・曖昧なときは必ず今日の日付。日本時間）",
  "fields": { ... },
  "summary": "概要欄用の短い見出しのみ（例: [飲食] または [交通費]。長文・店名・レシートの詳細は書かない）"
}

${modeInstruction(mode)}

fields のルール:
- category が kakeibo のとき:
  { "shubetsu": "支出|収入|その他", "amount": 数値（円、不明なら0）, "category": "飲食|食費|交通費|医療|塾関係|ペット費|日用品|通信|光熱費|住居|交際|娯楽|その他", "bikou": "備考は短く（店名＋一言でよい。レシートの住所・皿別明細・税の内訳・伝票番号などの全文は書かない）" }
- category が pet のとき: { "content": "内容（詳細）", "hospital": "病院名（なければ空文字）", "cost": 数値（円、不明なら0）, "nextDue": "次回予定（なければ空文字）" } ／ summary は短く（例: [ペット]）でよい ／ **動物病院・請求書では cost に実負担額（total_amount やお支払額）を必ず入れる（0 のままにしない）**
- category が log のとき: { "time": "時間帯（スプレッドシートのC列。例 10:00〜11:00 または 10:28。空なら可）", "content": "詳細・場所（D列の備考）", "tags": "カンマ区切りタグ（D列に続けて書く）" } ／ summary は短い見出しのみ（例: 散歩、勉強）。time の内容は content に繰り返さない ／ **ユーザーが日付を書いていなければ date は必ず今日（日本時間）。過去の日を勝手に埋めない**

家計簿カテゴリの補足ルール:
- 書籍 / 本 / 参考書 / 問題集 / 教材 / 学習アプリなど「勉強に使う購入」は、原則 category を "塾関係" にしてください。
- 動物病院の請求書で total_amount や「お支払額」がある場合は、小計や明細合計ではなくその実負担額を fields.amount に入れる。
- summary は短い見出しだけ。bikou は店名・用途を1〜2文で（レシートを貼り付けない）。金額は必ず fields.amount（円）に入れる。
- store_name / items / total だけの別形式に置き換えないでください。必ず category・date・fields・summary をトップレベルに含めてください。

ユーザーのテキスト:
${userText}
`;
}

function buildImagePrompt(mode: InputMode, hint?: string): string {
  const hintBlock =
    hint && hint.trim()
      ? `\nユーザーが添えたメモ（参考）:\n${hint.trim()}\n`
      : "";
  return `画像はレシート・領収書・メモの可能性があります。内容を読み取り、次の JSON 形だけを返してください。
${hintBlock}

{
  "category": "kakeibo" | "pet" | "log",
  "date": "YYYY-MM-DD（入力に日付がない場合は今日・日本時間）",
  "fields": { ... },
  "summary": "概要欄用の短い見出しのみ（例: [飲食]）。詳細は fields.bikou（家計簿）または各カテゴリの content などへ"
}

${modeInstruction(mode)}

fields のルールはテキスト解析と同じです（kakeibo / pet / log それぞれ）。
レシートなら通常 kakeibo。動物病院なら pet。**pet のときも診療費の数値は必ず fields.cost に入れる（請求書 JSON なら total_amount や支払額を cost に反映。0 のみは禁止）。**
kakeibo では金額は fields.amount に数値（円）を入れる。請求書・領収書に total_amount や保険控除後の支払額があるときはそれを優先（小計だけにしない）。fields.bikou は店名＋簡単なメモ程度（レシートの行ごとの羅列は禁止）。
行動ログでは fields.time をスプレッドシートの「時間」列にそのまま保存する（例 10:00〜11:00）。詳細は fields.content / tags に。

重要: store_name / items / total だけの別形式の JSON に置き換えないでください。必ず上記の category・date・fields・summary をトップレベルに含めてください（レシートでも同じ）。`;
}

function jstYmdTokyo(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function looksLikeStandardAnalysis(o: Record<string, unknown>): boolean {
  const cat = o.category;
  if (cat !== "kakeibo" && cat !== "pet" && cat !== "log") return false;
  const fields = o.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return false;
  if (typeof o.summary !== "string" || !o.summary.trim()) return false;
  const date = typeof o.date === "string" ? o.date : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function extractDateYmdLoose(o: Record<string, unknown>): string | null {
  const keys = [
    "date",
    "transaction_date",
    "purchase_date",
    "receipt_date",
    "sale_date",
  ];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  }
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string") {
      const m = v.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (m) {
        return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      }
    }
  }
  return null;
}

/** レシート・請求書 JSON の数値（文字列のカンマ付きも可） */
function receiptLikeNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * 支払額を推定。請求書は total_amount（保険控除後の支払額）を最優先し、
 * subtotal だけだと動物病院などで実負担とズレるため total のあとに回す。
 */
function pickReceiptTotal(o: Record<string, unknown>): number {
  const paymentKeys = [
    "total_amount",
    "grand_total",
    "payment_total",
    "amount_due",
    "balance_due",
    "total",
  ];
  for (const k of paymentKeys) {
    const n = receiptLikeNumber(o[k]);
    if (n != null && n !== 0) return Math.abs(n);
  }
  const sub = receiptLikeNumber(o.subtotal);
  if (sub != null && sub > 0) return sub;

  const items = Array.isArray(o.items) ? o.items : [];
  let sum = 0;
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const row = it as Record<string, unknown>;
    const lineTotal = receiptLikeNumber(row.amount);
    if (lineTotal != null && lineTotal > 0) {
      sum += lineTotal;
      continue;
    }
    const unit =
      receiptLikeNumber(row.price) ??
      receiptLikeNumber(row.unit_price) ??
      receiptLikeNumber(row.unitPrice);
    const qtyRaw = receiptLikeNumber(row.quantity);
    const qty =
      qtyRaw != null && qtyRaw > 0 ? qtyRaw : 1;
    if (unit != null && Number.isFinite(unit)) sum += unit * qty;
  }
  return sum > 0 ? sum : 0;
}

function buildBikouFromReceiptLike(o: Record<string, unknown>): string {
  const lines: string[] = [];
  const store = String(
    o.store_name ?? o.store ?? o.clinic_name ?? o.vendor_name ?? ""
  ).trim();
  if (store) lines.push(store);
  const items = Array.isArray(o.items) ? o.items : [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const row = it as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    const qty = row.quantity;
    const price =
      receiptLikeNumber(row.price) ??
      receiptLikeNumber(row.unit_price) ??
      receiptLikeNumber(row.amount);
    const parts: string[] = [];
    if (name) parts.push(name);
    if (typeof qty === "number") parts.push(`×${qty}`);
    if (price != null) parts.push(`${price}円`);
    const line = parts.join(" ");
    if (line) lines.push(line);
  }
  const extra: string[] = [];
  if (typeof o.payment_method === "string" && o.payment_method.trim()) {
    extra.push(`支払い: ${o.payment_method.trim()}`);
  }
  if (typeof o.tax_rate === "string" && o.tax_rate.trim()) {
    extra.push(`税率: ${o.tax_rate.trim()}`);
  }
  if (typeof o.tax_amount === "number" && o.tax_amount > 0) {
    extra.push(`税: ${o.tax_amount}円`);
  }
  if (typeof o.change === "number") {
    extra.push(`おつり: ${o.change}円`);
  }
  if (extra.length) lines.push(extra.join(" / "));
  return lines.join("\n").trim();
}

/**
 * モデルがレシート専用の別 JSON（store_name / items / total 等のみ）を返したとき
 * アプリの AnalysisResult に正規化する。
 */
function tryCoerceReceiptLikeSchema(
  o: Record<string, unknown>,
  mode: InputMode
): AnalysisResult | null {
  if (mode !== "auto" && mode !== "kakeibo" && mode !== "medical" && mode !== "juku") {
    return null;
  }
  const looksReceipt =
    o.store_name != null ||
    o.store != null ||
    o.clinic_name != null ||
    o.vendor_name != null ||
    o.total_amount != null ||
    (Array.isArray(o.items) && o.items.length > 0) ||
    typeof o.total === "number" ||
    typeof o.subtotal === "number";
  if (!looksReceipt) return null;

  const amount = pickReceiptTotal(o);
  const bikou = buildBikouFromReceiptLike(o);
  const date = extractDateYmdLoose(o) ?? jstYmdTokyo();

  const vetLike =
    String(o.clinic_name ?? "").trim() !== "" ||
    String(o.pet_name ?? "").trim() !== "" ||
    String(o.veterinarian ?? "").trim() !== "";
  const kakeiboCategory = vetLike ? "ペット費" : "飲食";
  const summaryTag = vetLike ? "[ペット費]" : "[飲食]";

  return {
    category: "kakeibo",
    date,
    fields: {
      shubetsu: "支出",
      amount: amount > 0 ? amount : 0,
      category: kakeiboCategory,
      bikou,
    },
    summary: summaryTag,
  };
}

function normalizeResult(raw: unknown, mode: InputMode): AnalysisResult {
  if (!raw || typeof raw !== "object") throw new Error("解析結果の形式が不正です。");
  const o = raw as Record<string, unknown>;

  if (!looksLikeStandardAnalysis(o)) {
    const coerced = tryCoerceReceiptLikeSchema(o, mode);
    if (coerced) return coerced;
  }

  const cat = o.category;
  if (cat !== "kakeibo" && cat !== "pet" && cat !== "log") {
    throw new Error(`category が不正です: ${String(cat)}`);
  }
  let date = typeof o.date === "string" ? o.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = extractDateYmdLoose(o) ?? jstYmdTokyo();
  }
  const fields = o.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("fields がオブジェクトではありません。");
  }
  const summary = typeof o.summary === "string" ? o.summary : "";
  if (!summary) throw new Error("summary がありません。");
  return {
    category: cat,
    date,
    fields: fields as Record<string, string | number | boolean | null>,
    summary,
  };
}

function applyModeOverrides(mode: InputMode, r: AnalysisResult): AnalysisResult {
  if (mode === "medical") {
    const detail =
      String(r.fields.bikou ?? "").trim() ||
      String(r.fields.memo ?? "").trim() ||
      String(r.summary).replace(/^\[医療\]\s*/, "").trim();
    return {
      ...r,
      category: "kakeibo",
      fields: { ...r.fields, category: "医療", bikou: detail },
      summary: "[医療]",
    };
  }
  if (mode === "juku") {
    const detail =
      String(r.fields.bikou ?? "").trim() ||
      String(r.fields.memo ?? "").trim() ||
      String(r.summary).replace(/^\[塾関係\]\s*/, "").trim();
    return {
      ...r,
      category: "kakeibo",
      fields: { ...r.fields, category: "塾関係", bikou: detail },
      summary: "[塾関係]",
    };
  }
  return r;
}

export async function analyzeText(
  mode: InputMode,
  text: string
): Promise<AnalysisResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("テキストが空です。");

  return withGeminiModelFallback(async (modelId) => {
    const genAI = getClient();
    const model = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });

    const result = await model.generateContent(buildPrompt(mode, trimmed));
    const response = result.response;
    const out = response.text();
    const parsed = parseModelJsonText(out);
    return applyModeOverrides(mode, normalizeResult(parsed, mode));
  });
}

export async function analyzeImage(
  mode: InputMode,
  base64: string,
  mimeType: string,
  hint?: string
): Promise<AnalysisResult> {
  if (!base64) throw new Error("画像データがありません。");

  return withGeminiModelFallback(async (modelId) => {
    const genAI = getClient();
    const model = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });

    const imagePart = {
      inlineData: {
        data: base64,
        mimeType: mimeType || "image/jpeg",
      },
    };

    const result = await model.generateContent([
      buildImagePrompt(mode, hint),
      imagePart,
    ]);
    const out = result.response.text();
    const parsed = parseModelJsonText(out);
    return applyModeOverrides(mode, normalizeResult(parsed, mode));
  });
}
