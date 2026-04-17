/**
 * モデル応答文字列から JSON を取り出してパース（フェンス付きにも対応）
 */
export function parseModelJsonText(rawText: string): unknown {
  if (rawText == null || String(rawText).trim() === "") {
    throw new Error("モデル応答が空です。");
  }
  let s = String(rawText).trim();
  s = s.replace(/^```(?:json|JSON)?\s*\r?\n?/m, "");
  s = s.replace(/\r?\n?```\s*$/m, "");
  s = s.trim();
  s = s.replace(/```(?:json|JSON)?/gi, "").replace(/```/g, "").trim();

  try {
    return JSON.parse(s) as unknown;
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const slice = s.slice(start, end + 1);
      return JSON.parse(slice) as unknown;
    }
    throw new Error("JSON として解釈できませんでした。");
  }
}
