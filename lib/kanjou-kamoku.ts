/** スプレッドシート D 列（勘定科目）の候補 */
export const KANJOU_KAMOKU_LIST = [
  "飲食",
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
  "仕事",
  "その他",
] as const;

export type KanjouKamoku = (typeof KANJOU_KAMOKU_LIST)[number];

const ALIASES: Record<string, KanjouKamoku | string> = {
  外食: "飲食",
  食事: "飲食",
  カフェ: "飲食",
  コンビニ: "飲食",
  スーパー: "食費",
  ガソリン: "交通費",
  電車: "交通費",
  タクシー: "交通費",
  病院: "医療",
  動物病院: "ペット費",
  ペット: "ペット費",
  ネット: "通信",
  インターネット: "通信",
  光: "光熱費",
  電気: "光熱費",
  ガス: "光熱費",
  家賃: "住居",
  教材: "塾関係",
  参考書: "塾関係",
  本: "塾関係",
};

/** fields.category / 概要 [タグ] を D 列用の勘定科目に正規化 */
export function normalizeKanjouKamoku(
  raw: string,
  fallback: KanjouKamoku | string = "その他"
): string {
  const s = String(raw ?? "").trim();
  if (!s) return fallback;
  const bracket = s.match(/^\[([^\]]+)\]/);
  const core = (bracket ? bracket[1] : s).trim();
  if (!core) return fallback;
  if ((KANJOU_KAMOKU_LIST as readonly string[]).includes(core)) return core;
  const alias = ALIASES[core];
  if (alias) return alias;
  return core;
}

/** 家計簿解析結果から勘定科目を決める */
export function kanjouFromKakeiboAnalysis(summary: string, fields: Record<string, unknown>): string {
  const fromField = String(fields.category ?? "").trim();
  if (fromField) return normalizeKanjouKamoku(fromField);
  const m = summary.trim().match(/^\[([^\]]+)\]/);
  if (m) return normalizeKanjouKamoku(m[1]);
  return "その他";
}
