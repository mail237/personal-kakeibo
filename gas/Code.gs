/**
 * Next.js (server) → GAS WebApp → Google Spreadsheet
 *
 * 事前に「プロジェクトの設定」→「スクリプト プロパティ」に設定:
 * - SPREADSHEET_ID: 保存先スプレッドシートID
 * - GAS_SHARED_SECRET: Next.js の GAS_SHARED_SECRET と同じ値
 *
 * タブ名（完全一致）。列はすべて A〜D の4列（1行目に見出し推奨）:
 * - 家計簿・医療・塾関係・ペット記録: A日付(YYYY-MM-DD) | B概要(短い一言) | C金額(数値のみ) | D備考
 * - 行動ログ: A日付 | B概要(短い一言) | C時間(例 10:00〜11:00) | D備考(詳細・タグ等)
 * - 家計簿で fields.category が「医療」→「医療」タブ、「塾関係」→「塾関係」タブ、それ以外→「家計簿」
 * - append は直前行と4列とも同一なら追加しない（二重送信対策）
 */

const SHEET_NAMES = {
  kakeibo: "家計簿",
  medical: "医療",
  juku: "塾関係",
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

/** 全角数字 → 半角 */
function normalizeFwDigits_(s) {
  return String(s).replace(/[\uFF10-\uFF19]/g, function (ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30);
  });
}

/** 全角括弧 ［］ → 半角 []（概要の正規表現マッチ用） */
function normalizeFwBrackets_(s) {
  return String(s).replace(/\uFF3B/g, "[").replace(/\uFF3D/g, "]");
}

/** summary の「合計1,580円」「1,580円」から円を拾う（モデルが amount=0 のときの保険） */
function extractYenFromSummary_(text) {
  if (!text) return 0;
  var s = normalizeFwDigits_(String(text))
    .replace(/\u3000/g, " ")
    .replace(/\uFF0C/g, ",");
  var compact = s.replace(/\s/g, "");
  var m = compact.match(/合計\s*[:：]?\s*([\d,]+)\s*円/);
  if (m) return asNumber_(m[1]);
  var all = s.match(/([\d,]+)\s*円/g);
  if (!all || all.length === 0) {
    var all2 = compact.match(/([\d,]+)円/g);
    if (!all2 || all2.length === 0) {
      var bare = compact.match(/(\d{2,7})円/g);
      if (bare && bare.length > 0) {
        var lb = bare[bare.length - 1].match(/(\d+)/);
        return lb ? asNumber_(lb[1]) : 0;
      }
      return 0;
    }
    var last2 = all2[all2.length - 1].match(/([\d,]+)/);
    return last2 ? asNumber_(last2[1]) : 0;
  }
  var last = all[all.length - 1].match(/([\d,]+)/);
  if (last) return asNumber_(last[1]);
  /** 文中の「○○円」をすべて走査し最大値（複数表記対策） */
  var u = normalizeFwDigits_(String(text)).replace(/\uFF0C/g, ",");
  var rx = /(\d{1,3}(?:,\d{3})+|\d{2,7})\s*円/g;
  var best = 0;
  var mm;
  while ((mm = rx.exec(u)) !== null) {
    var v = asNumber_(mm[1]);
    if (v > best) best = v;
  }
  if (best > 0) return best;
  var compact2 = u.replace(/\s/g, "");
  var rx2 = /(\d{2,7})円/g;
  while ((mm = rx2.exec(compact2)) !== null) {
    var v2 = asNumber_(mm[1]);
    if (v2 > best) best = v2;
  }
  return best > 0 ? best : 0;
}

/** 家計簿: 概要を [タグ] のみにし詳細を備考へ。金額は最後に summary+備考から再抽出（Next 側が古くても効く） */
function normalizeKakeiboRowForSheet_(analysis) {
  var sum = normalizeFwBrackets_(mustString_(analysis.summary));
  var bikou = bikouFromAnalysis_(analysis);
  var amt = amountFromAnalysis_(analysis);
  var m = sum.match(/^\[([^\]]+)\]/);
  if (m) {
    var short = "[" + m[1] + "]";
    var rest = sum.replace(/^\[[^\]]+\]\s*/, "").trim();
    if (rest) {
      bikou = bikou ? bikou + "\n" + rest : rest;
    }
    sum = short;
  }
  if (amt <= 0) {
    amt = extractYenFromSummary_(sum + " " + bikou);
  }
  return { summary: sum, amount: amt, bikou: bikou };
}

/** 備考列: 家計簿は bikou（なければ memo）、ペットは病院・内容・次回 */
function bikouFromAnalysis_(analysis) {
  const f = analysis.fields || {};
  if (analysis.category === "kakeibo") {
    var b = mustString_(f.bikou);
    if (b) return b;
    return mustString_(f.memo);
  }
  if (analysis.category === "pet") {
    var parts = [
      mustString_(f.content),
      mustString_(f.hospital),
      mustString_(f.nextDue),
    ].filter(function (x) {
      return x;
    });
    return parts.join(" / ");
  }
  return "";
}

/** B列用: [飲食] → 飲食（既存シートの短文概要に合わせる） */
function briefSummaryForSheet_(summary) {
  var s = normalizeFwBrackets_(mustString_(summary).trim());
  var m = s.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (m) {
    var inner = m[1].trim();
    var rest = (m[2] || "").trim();
    return rest ? inner + " " + rest : inner;
  }
  return s;
}

/** 行動ログ C列: 時間（単一時刻でも範囲でもそのまま） */
function logTimeColumnC_(analysis) {
  var f = analysis.fields || {};
  return mustString_(f.time).trim();
}

/** 行動ログ D列: 詳細・タグ（時間は C に載せるためここには含めない） */
function logRemarksColumnD_(analysis) {
  var f = analysis.fields || {};
  return [mustString_(f.content), mustString_(f.tags)]
    .filter(function (x) {
      return x;
    })
    .join(" / ");
}

function normalizeCellForCompare_(v) {
  if (v == null) return "";
  if (typeof v === "number" && !isNaN(v)) return String(v);
  return String(v).trim();
}

/** 直前のデータ行と同一なら true（1件1行・二重保存防止） */
function isDuplicateOfLastRow_(sheet, newRow) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var prev = sheet.getRange(lastRow, 1, lastRow, 4).getValues()[0];
  for (var i = 0; i < 4; i++) {
    if (normalizeCellForCompare_(prev[i]) !== normalizeCellForCompare_(newRow[i])) {
      return false;
    }
  }
  return true;
}

/** 金額列用: カテゴリごとに fields から数値を取る（行動ログは 0） */
function amountFromAnalysis_(analysis) {
  const f = analysis.fields || {};
  if (analysis.category === "kakeibo") {
    var n = asNumber_(f.amount);
    if (n > 0) return n;
    var combined =
      mustString_(analysis.summary) +
      " " +
      mustString_(f.bikou) +
      " " +
      mustString_(f.memo);
    return extractYenFromSummary_(combined);
  }
  if (analysis.category === "pet") return asNumber_(f.cost);
  return 0;
}

/** 家計簿のとき、fields.category または summary の接頭辞で別タブへ */
function resolveSheetName_(analysis) {
  if (analysis.category === "pet") return SHEET_NAMES.pet;
  if (analysis.category === "log") return SHEET_NAMES.log;
  if (analysis.category !== "kakeibo") return SHEET_NAMES.kakeibo;
  var f = analysis.fields || {};
  var fc = mustString_(f.category);
  var sum = mustString_(analysis.summary);
  if (fc === "医療" || /^\[医療\]/.test(sum) || /^【医療】/.test(sum)) {
    return SHEET_NAMES.medical;
  }
  if (fc === "塾関係" || /^\[塾関係\]/.test(sum) || /^【塾関係】/.test(sum)) {
    return SHEET_NAMES.juku;
  }
  return SHEET_NAMES.kakeibo;
}

/**
 * @returns {{ deduped: boolean }}
 */
function append_(analysis) {
  validateAnalysis_(analysis);
  const { spreadsheetId } = getProps_();
  const ss = SpreadsheetApp.openById(spreadsheetId);
  var sheetName = resolveSheetName_(analysis);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`タブ「${sheetName}」が見つかりません`);

  var row;
  if (analysis.category === "kakeibo") {
    var fin = normalizeKakeiboRowForSheet_(analysis);
    var amtK = fin.amount > 0 ? Number(fin.amount) : 0;
    row = [analysis.date, briefSummaryForSheet_(fin.summary), amtK, fin.bikou];
  } else if (analysis.category === "pet") {
    var amtP = amountFromAnalysis_(analysis);
    row = [
      analysis.date,
      briefSummaryForSheet_(mustString_(analysis.summary)),
      amtP > 0 ? Number(amtP) : 0,
      bikouFromAnalysis_(analysis),
    ];
  } else if (analysis.category === "log") {
    row = [
      analysis.date,
      briefSummaryForSheet_(mustString_(analysis.summary)),
      logTimeColumnC_(analysis),
      logRemarksColumnD_(analysis),
    ];
  } else {
    throw new Error("category が不正です");
  }

  if (isDuplicateOfLastRow_(sheet, row)) {
    return { deduped: true };
  }
  sheet.appendRow(row);
  return { deduped: false };
}

/** 直近一覧用: A列の Date を YYYY-MM-DD に（String(date) だと英語の長文になる） */
function sheetCellToApiString_(c, colIndex) {
  if (c == null || c === "") return "";
  if (colIndex === 0 && Object.prototype.toString.call(c) === "[object Date]") {
    return Utilities.formatDate(c, "Asia/Tokyo", "yyyy-MM-dd");
  }
  if (typeof c === "number") return String(c);
  return String(c);
}

/**
 * @returns {{ entries: Array, missingTabs: Array<string>, headerOnlyTabs: Array<string> }}
 */
function recent_(limitPerSheet) {
  const { spreadsheetId } = getProps_();
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const limit = Math.max(1, Math.min(30, Number(limitPerSheet || 6)));

  const out = [];
  const missingTabs = [];
  const headerOnlyTabs = [];
  const order = [
    { key: "kakeibo", label: "家計簿" },
    { key: "medical", label: "医療" },
    { key: "juku", label: "塾関係" },
    { key: "pet", label: "ペット" },
    { key: "log", label: "行動ログ" },
  ];

  order.forEach((o) => {
    const sheetName = SHEET_NAMES[o.key];
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      missingTabs.push(sheetName);
      return;
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      headerOnlyTabs.push(sheetName);
      return;
    }
    const startRow = Math.max(2, lastRow - limit + 1);
    const numRows = lastRow - startRow + 1;
    // A〜D（行動ログのみ C が「時間」。それ以外は C が金額）
    const values = sheet.getRange(startRow, 1, numRows, 4).getValues();
    values
      .slice()
      .reverse()
      .forEach((r) => {
        const cells = r.map(function (c, j) {
          return sheetCellToApiString_(c, j);
        });
        if (cells.every((c) => c === "")) return;
        out.push({ sheet: o.key, label: o.label, cells: cells });
      });
  });

  // 日付（cells[0]）で降順
  out.sort((a, b) => String(b.cells[0] || "").localeCompare(String(a.cells[0] || "")));

  return {
    entries: out.slice(0, limit * order.length),
    missingTabs: missingTabs,
    headerOnlyTabs: headerOnlyTabs,
  };
}

/** ブラウザで /exec を開いたとき（GET）。本番利用は Next からの POST。 */
function doGet() {
  return ContentService.createTextOutput(
    "personal-kakeibo GAS OK. この URL は POST（JSON）で使います。"
  ).setMimeType(ContentService.MimeType.PLAIN);
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
      var ar = append_(body.analysis);
      return jsonOut_({ ok: true, deduped: ar.deduped === true });
    }
    if (action === "recent") {
      var rr = recent_(body.limitPerSheet);
      return jsonOut_({
        ok: true,
        entries: rr.entries,
        missingTabs: rr.missingTabs,
        headerOnlyTabs: rr.headerOnlyTabs,
      });
    }
    return errorOut_("action が不正です", 400);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return errorOut_(msg, 500);
  }
}

