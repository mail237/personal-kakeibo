export type InputMode =
  | "auto"
  | "kakeibo"
  | "medical"
  | "juku"
  | "pet"
  | "log";

/** Gemini / プレビュー用（スプレッドシートの「塾関係」タブは kakeibo + fields.category で表す） */
export type AnalysisCategory = "kakeibo" | "pet" | "log";

/** 直近一覧の出所（GAS の sheet キー） */
export type SheetCategory = AnalysisCategory | "medical" | "juku";

/** Gemini が返す解析結果（保存前プレビュー用） */
export type AnalysisResult = {
  category: AnalysisCategory;
  date: string;
  fields: Record<string, string | number | boolean | null>;
  summary: string;
};

export type KakeiboRow = {
  date: string;
  shubetsu: string;
  amount: number | string;
  category: string;
  /** 旧データ用。詳細は bikou を優先 */
  memo?: string;
  /** 備考（詳細） */
  bikou?: string;
};

export type PetRow = {
  date: string;
  content: string;
  hospital: string;
  cost: number | string;
  nextDue: string;
};

export type LogRow = {
  date: string;
  time: string;
  content: string;
  tags: string;
};

export type RecentEntry = {
  sheet: SheetCategory;
  label: string;
  cells: string[];
};
