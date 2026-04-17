export type InputMode = "auto" | "kakeibo" | "pet" | "log";

export type SheetCategory = "kakeibo" | "pet" | "log";

/** Gemini が返す解析結果（保存前プレビュー用） */
export type AnalysisResult = {
  category: SheetCategory;
  date: string;
  fields: Record<string, string | number | boolean | null>;
  summary: string;
};

export type KakeiboRow = {
  date: string;
  shubetsu: string;
  amount: number | string;
  category: string;
  memo: string;
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
