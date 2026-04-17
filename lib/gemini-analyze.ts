import { GoogleGenerativeAI } from "@google/generative-ai";
import type { InputMode, SheetCategory } from "./types";
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
] as const;

function shouldTryNextModel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /404|429|quota|Quota|not found|NOT_FOUND|RESOURCE_EXHAUSTED/i.test(msg);
}

async function withGeminiModelFallback<T>(
  run: (modelId: string) => Promise<T>
): Promise<T> {
  const explicit = process.env.GEMINI_MODEL?.trim();
  if (explicit) {
    return run(explicit);
  }
  let lastErr: unknown;
  for (const id of GEMINI_MODEL_FALLBACKS) {
    try {
      return await run(id);
    } catch (e) {
      lastErr = e;
      if (shouldTryNextModel(e)) {
        continue;
      }
      throw e;
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
  const map: Record<Exclude<InputMode, "auto">, SheetCategory> = {
    kakeibo: "kakeibo",
    pet: "pet",
    log: "log",
  };
  const labels: Record<Exclude<InputMode, "auto">, string> = {
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
  "date": "YYYY-MM-DD（不明なら今日の日付を推定。日本時間基準）",
  "fields": { ... },
  "summary": "一行の日本語サマリー"
}

${modeInstruction(mode)}

fields のルール:
- category が kakeibo のとき: { "shubetsu": "支出|収入|その他", "amount": 数値（円、不明なら0）, "category": "食費|交通費|医療|ペット費|その他 など", "memo": "補足" }
- category が pet のとき: { "content": "内容", "hospital": "病院名（なければ空文字）", "cost": 数値（円、不明なら0）, "nextDue": "次回予定（なければ空文字）" }
- category が log のとき: { "time": "HH:mm または空", "content": "内容", "tags": "カンマ区切りタグ" }

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
  "date": "YYYY-MM-DD",
  "fields": { ... },
  "summary": "一行の日本語サマリー"
}

${modeInstruction(mode)}

fields のルールはテキスト解析と同じです（kakeibo / pet / log それぞれ）。
レシートなら通常 kakeibo。動物病院なら pet。`;
}

function normalizeResult(raw: unknown): AnalysisResult {
  if (!raw || typeof raw !== "object") throw new Error("解析結果の形式が不正です。");
  const o = raw as Record<string, unknown>;
  const cat = o.category;
  if (cat !== "kakeibo" && cat !== "pet" && cat !== "log") {
    throw new Error(`category が不正です: ${String(cat)}`);
  }
  const date = typeof o.date === "string" ? o.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`date が YYYY-MM-DD 形式ではありません: ${String(o.date)}`);
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
    return normalizeResult(parsed);
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
    return normalizeResult(parsed);
  });
}
