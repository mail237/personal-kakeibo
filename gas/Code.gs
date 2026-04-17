/**
 * Next.js (server) → GAS WebApp → Google Spreadsheet
 *
 * 事前に「プロジェクトの設定」→「スクリプト プロパティ」に設定:
 * - SPREADSHEET_ID: 保存先スプレッドシートID
 * - GAS_SHARED_SECRET: Next.js の GAS_SHARED_SECRET と同じ値
 *
 * スプレッドシート内のタブ名（完全一致）。各タブとも列は次の3つ（1行目に見出し推奨）:
 * - 家計簿 / ペット記録 / 行動ログ 共通: 日付 | 概要 | 金額
 *   ※概要は AI の summary、金額は家計簿は amount、ペットは cost、行動ログは 0
 */

const SHEET_NAMES = {
  kakeibo: "家計簿",
  pet: "ペット記録",
  log: "行動ログ",
};

function getProps_() {
  const p = PropertiesService.getScriptProperties();
  const spreadsheetId = String(p.getProperty("SPREADSHEET_ID") || "").trim();
  const secret = String(p.getProperty("GAS_SHARED_SECRET") || "").trim();
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID が未設定です");
  if (!secret) throw new Error("GAS_SHARED_SECRET が未設定です");
  return { spreadsheetId, secret };
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function errorOut_(message, status) {
  // GAS WebApp は任意のステータスコードを返しづらいので、ok:falseで返す
  return jsonOut_({ ok: false, error: message, status: status || 500 });
}

function mustString_(v) {
  if (v == null) return "";
  return String(v);
}

function asNumber_(v) {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return isFinite(n) ? n : 0;
  }
  return 0;
}

function validateAnalysis_(a) {
  if (!a || typeof a !== "object") throw new Error("analysis が不正です");
  const cat = a.category;
  if (cat !== "kakeibo" && cat !== "pet" && cat !== "log") {
    throw new Error("category が不正です");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.date || ""))) {
    throw new Error("date が不正です");
  }
  if (!a.fields || typeof a.fields !== "object") throw new Error("fields が不正です");
  return true;
}

/** 金額列用: カテゴリごとに fields から数値を取る（行動ログは 0） */
function amountFromAnalysis_(analysis) {
  const f = analysis.fields || {};
  if (analysis.category === "kakeibo") return asNumber_(f.amount);
  if (analysis.category === "pet") return asNumber_(f.cost);
  return 0;
}

function append_(analysis) {
  validateAnalysis_(analysis);
  const { spreadsheetId } = getProps_();
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheetName = SHEET_NAMES[analysis.category];
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`タブ「${sheetName}」が見つかりません`);

  var summary = mustString_(analysis.summary);
  var amt = amountFromAnalysis_(analysis);
  // 列: 日付 | 概要 | 金額
  var row = [analysis.date, summary, amt];
  sheet.appendRow(row);
}

function recent_(limitPerSheet) {
  const { spreadsheetId } = getProps_();
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const limit = Math.max(1, Math.min(30, Number(limitPerSheet || 6)));

  const out = [];
  const order = [
    { key: "kakeibo", label: "家計簿" },
    { key: "pet", label: "ペット" },
    { key: "log", label: "行動ログ" },
  ];

  order.forEach((o) => {
    const sheetName = SHEET_NAMES[o.key];
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return; // ヘッダのみ
    const startRow = Math.max(2, lastRow - limit + 1);
    const numRows = lastRow - startRow + 1;
    // 日付・概要・金額の3列
    const values = sheet.getRange(startRow, 1, numRows, 3).getValues();
    values
      .slice()
      .reverse()
      .forEach((r) => {
        const cells = r.map((c) => (c == null ? "" : String(c)));
        if (cells.every((c) => c === "")) return;
        out.push({ sheet: o.key, label: o.label, cells: cells });
      });
  });

  // 日付（cells[0]）で降順
  out.sort((a, b) => String(b.cells[0] || "").localeCompare(String(a.cells[0] || "")));

  return out.slice(0, limit * 3);
}

function doPost(e) {
  try {
    const { secret } = getProps_();
    const headers = (e && e.parameter) || {};
    // Apps Script は生ヘッダー取得が難しいため、query か body に secret を持たせるより
    // Next.js 側でヘッダーを付ける場合、e.parameter には入りません。
    // そのため「bodyの中」に secret を同梱する方式にします（下でチェック）。

    if (!e || !e.postData || !e.postData.contents) {
      return errorOut_("postData がありません", 400);
    }
    const body = JSON.parse(e.postData.contents);
    var reqSecret = body && body.secret != null ? String(body.secret).trim() : "";
    var okSecret = secret != null ? String(secret).trim() : "";
    if (!body || reqSecret !== okSecret) {
      return errorOut_("認証に失敗しました（secret）", 401);
    }

    const action = String(body.action || "");
    if (action === "append") {
      append_(body.analysis);
      return jsonOut_({ ok: true });
    }
    if (action === "recent") {
      const entries = recent_(body.limitPerSheet);
      return jsonOut_({ ok: true, entries: entries });
    }
    return errorOut_("action が不正です", 400);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return errorOut_(msg, 500);
  }
}

