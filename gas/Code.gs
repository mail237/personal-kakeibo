/**
 * Next.js (server) → GAS WebApp → Google Spreadsheet
 *
 * 事前に「プロジェクトの設定」→「スクリプト プロパティ」に設定:
 * - SPREADSHEET_ID: 保存先スプレッドシートID
 * - GAS_SHARED_SECRET: Next.js の GAS_SHARED_SECRET と同じ値
 *
 * タブ名（完全一致）。1行目に見出し推奨:
 * - 家計簿・医療・塾関係・ペット記録（5列）: A日付 | B概要 | C金額 | D勘定科目 | E備考
 * - 行動ログ（4列）: A日付 | B概要 | C時間 | D備考(詳細・タグ等)
 * - 食事（4列）: A日付 | B概要 | Cカロリー(kcal) | D備考
 * - 家計簿で fields.category が「医療」→「医療」タブ、「塾関係」→「塾関係」タブ、それ以外→「家計簿」
 * - append は直前行と全列同一なら追加しない（二重送信対策）
 * - 家計簿・医療・塾関係・ペット・行動ログは保存後に A列日付の昇順（古い順）で並べ替え
 * - 食事タブは「合計」行のため自動並べ替えなし（メニューからの一括整理も対象外）
 */

const SHEET_NAMES = {
  kakeibo: "家計簿",
  medical: "医療",
  juku: "塾関係",
  pet: "ペット記録",
  log: "行動ログ",
  meal: "食事",
};

/** D列＝勘定科目・E列＝備考のタブ */
const SHEETS_WITH_KANJOU_COL = [
  SHEET_NAMES.kakeibo,
  SHEET_NAMES.medical,
  SHEET_NAMES.juku,
  SHEET_NAMES.pet,
];

/** 日付の古い順に並べ替えるタブ（食事は「合計」行があるため対象外） */
const SHEETS_SORT_DATE_ASC = [
  SHEET_NAMES.kakeibo,
  SHEET_NAMES.medical,
  SHEET_NAMES.juku,
  SHEET_NAMES.pet,
  SHEET_NAMES.log,
];

function sheetDataColumnCount_(sheetName) {
  return SHEETS_WITH_KANJOU_COL.indexOf(sheetName) >= 0 ? 5 : 4;
}

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
  if (cat !== "kakeibo" && cat !== "pet" && cat !== "log" && cat !== "meal") {
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
  /** 請求書 JSON の total_amount（実負担額）。モデルが本文に含めたときの保険 */
  var jsonTotal = String(text).match(/["']?total_amount["']?\s*:\s*(\d+)/);
  if (jsonTotal) {
    var jv = asNumber_(jsonTotal[1]);
    if (jv > 0) return jv;
  }
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

function shouldCompressBikouForSheet_(b) {
  if (!b) return false;
  var s = String(b);
  if (/円皿|小計|合計\s*[:：]|外税|伝票|テーブル|登録番号|合計点数/.test(s)) return true;
  var lines = s.split(/\r?\n/).filter(function (l) {
    return l.trim();
  });
  return s.length > 220 || lines.length > 6;
}

/** レシート羅列の備考を店名付近だけに短縮（Next と同趣旨） */
function compressKakeiboBikouForSheet_(bikou) {
  var lines = String(bikou)
    .split(/\r?\n/)
    .map(function (l) {
      return l.trim();
    })
    .filter(function (x) {
      return x;
    });
  var skipLine =
    /^\d+\s*円皿|^[（(]?\d+%|小計|合計|外税|内税|伝票|テーブル|登録番号|軽減税率|合計点数|電子マネー|おつり|現金|クレジット|ポイント|^O\d|扱|消費税等|会計|^\(\d+%|\d+\s*[×x]\s*\d+\s*=\s*[\d,，]+\s*円/i;
  var looksAddr = /[市区町村]|丁目|番地|号|〒|地下街|^\d+-\d+-\d+|県$/;
  var kept = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (skipLine.test(line)) continue;
    if (looksAddr.test(line)) continue;
    if (/^[\d,，\s円×=xX（）()%-]+$/i.test(line)) continue;
    kept.push(line);
    if (kept.length >= 2) break;
  }
  var out = kept.join(" ").replace(/\s+/g, " ").trim();
  if (!out) out = lines[0] ? lines[0].slice(0, 100) : "";
  if (out.length > 120) out = out.slice(0, 117) + "…";
  return out;
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
      var bTrim = String(bikou).trim();
      var rTrim = String(rest).trim();
      if (bTrim && rTrim && (bTrim.indexOf(rTrim) >= 0 || rTrim.indexOf(bTrim) >= 0)) {
        bikou = bTrim.length >= rTrim.length ? bTrim : rTrim;
      } else {
        bikou = bTrim ? bTrim + "\n" + rTrim : rTrim;
      }
    }
    sum = short;
  }
  if (amt <= 0) {
    amt = extractYenFromSummary_(sum + " " + bikou);
  }
  if (shouldCompressBikouForSheet_(bikou)) {
    bikou = compressKakeiboBikouForSheet_(bikou);
  }
  return { summary: sum, amount: amt, bikou: bikou };
}

/** D列: 勘定科目（fields.category または概要 [タグ]） */
function kanjouKamokuForSheet_(analysis, fin) {
  var f = analysis.fields || {};
  var c = mustString_(f.category).trim();
  if (c) return c;
  var sum = fin ? mustString_(fin.summary) : mustString_(analysis.summary);
  var m = sum.match(/^\[([^\]]+)\]/);
  if (m) return m[1].trim();
  var sheetName = resolveSheetName_(analysis);
  if (sheetName === SHEET_NAMES.medical) return "医療";
  if (sheetName === SHEET_NAMES.juku) return "塾関係";
  if (analysis.category === "pet") return "ペット費";
  return "その他";
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

/** 食事 C列: カロリー（kcal 数値） */
function mealCaloriesColumnC_(analysis) {
  var f = analysis.fields || {};
  var n = asNumber_(f.calories);
  return n > 0 ? Number(n) : 0;
}

/** 食事 D列: 料理・量の前提など */
function mealRemarksColumnD_(analysis) {
  var f = analysis.fields || {};
  return [mustString_(f.items), mustString_(f.details), mustString_(f.tags)]
    .filter(function (x) {
      return x;
    })
    .join(" / ");
}

/** 食事の「合計」行かどうか */
function isMealTotalRow_(cells) {
  if (!cells || cells.length < 4) return false;
  const b = mustString_(cells[1]).trim();
  const d = mustString_(cells[3]).trim();
  return /^合計/.test(b) && /自動/.test(d);
}

/** 末尾が同日の「合計」行なら削除（追加→合計の付け直し用） */
function deleteTrailingMealTotalRowIfAny_(sheet, ymd) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const cells = sheet.getRange(lastRow, 1, 1, 4).getValues()[0];
  const a = sheetCellToApiString_(cells[0], 0);
  if (a !== ymd) return false;
  if (!isMealTotalRow_(cells)) return false;
  sheet.deleteRow(lastRow);
  return true;
}

/** 指定日の kcal を合計し、末尾に「合計」行を追加する */
function appendMealDailyTotalRow_(sheet, ymd) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  var sum = 0;
  for (var i = 0; i < values.length; i++) {
    const r = values[i];
    const a = sheetCellToApiString_(r[0], 0);
    if (a !== ymd) continue;
    if (isMealTotalRow_(r)) continue;
    sum += asNumber_(r[2]);
  }
  sheet.appendRow([ymd, "合計", sum > 0 ? Number(sum) : 0, "（自動）"]);
}

function normalizeCellForCompare_(v) {
  if (v == null) return "";
  if (typeof v === "number" && !isNaN(v)) return String(v);
  return String(v).trim();
}

/** 直近データ行のいずれかと全列同一なら true（二重送信・連打対策） */
function isDuplicateOfRecentRows_(sheet, newRow, maxRows, numCols) {
  var cols = numCols || newRow.length || 4;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var max = Math.min(maxRows || 5, lastRow - 1);
  for (var offset = 0; offset < max; offset++) {
    var r = lastRow - offset;
    var prev = sheet.getRange(r, 1, 1, cols).getValues()[0];
    var same = true;
    for (var i = 0; i < cols; i++) {
      if (normalizeCellForCompare_(prev[i]) !== normalizeCellForCompare_(newRow[i])) {
        same = false;
        break;
      }
    }
    if (same) return true;
  }
  return false;
}

/** A列の日付を YYYY-MM-DD 文字列に揃える（並べ替え・表示のため） */
function normalizeDateColumnA_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  var numRows = lastRow - 1;
  var range = sheet.getRange(2, 1, numRows, 1);
  var values = range.getValues();
  var changed = false;
  var out = values.map(function (row) {
    var c = row[0];
    if (Object.prototype.toString.call(c) === "[object Date]") {
      changed = true;
      return [Utilities.formatDate(c, "Asia/Tokyo", "yyyy-MM-dd")];
    }
    var s = String(c == null ? "" : c).trim();
    if (!s) return [""];
    var m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m) {
      var norm =
        m[1] +
        "-" +
        ("0" + m[2]).slice(-2) +
        "-" +
        ("0" + m[3]).slice(-2);
      if (norm !== s) changed = true;
      return [norm];
    }
    return [s];
  });
  if (changed) range.setValues(out);
}

/** 2行目以降を A列（日付）の昇順（古い→新しい）に並べ替え */
function sortSheetByDateAsc_(sheet, numCols) {
  var cols = numCols || sheetDataColumnCount_(sheet.getName());
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  var numRows = lastRow - 1;
  normalizeDateColumnA_(sheet);
  sheet.getRange(2, 1, numRows, cols).sort({ column: 1, ascending: true });
  return numRows;
}

function shouldAutoSortSheet_(sheetName) {
  return SHEETS_SORT_DATE_ASC.indexOf(sheetName) >= 0;
}

var KANJOU_KAMOKU_NAMES_ = [
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
];

function extractKanjouFromSummaryCell_(summary) {
  var m = mustString_(summary).match(/^\[([^\]]+)\]/);
  return m ? m[1].trim() : "";
}

/** 旧形式で D 列に入っていた「備考」らしいか（勘定科目の短い名前ではない） */
function looksLikeLegacyBikouInD_(d) {
  var s = mustString_(d).trim();
  if (!s) return false;
  if (KANJOU_KAMOKU_NAMES_.indexOf(s) >= 0) return false;
  if (s.length > 20) return true;
  if (/\n|\r/.test(s)) return true;
  if (/円|〒|丁目|番地|店|株式会社|有限|レシート|伝票|おつり|小計|合計/.test(s)) {
    return true;
  }
  return false;
}

/**
 * 旧4列（D=備考）→ 5列（D=勘定科目, E=備考）へ移行。
 * E が空で D に備考らしい文字がある行だけ処理。
 */
function migrateLegacyColumnDToE_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var numRows = lastRow - 1;
  var width = Math.max(5, sheet.getLastColumn());
  if (width < 4) width = 4;
  var values = sheet.getRange(2, 1, numRows, width).getValues();
  var changed = 0;
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    while (r.length < 5) r.push("");
    var a = r[0];
    var b = r[1];
    var c = r[2];
    var d = r[3];
    var e = r[4];
    var eStr = mustString_(e).trim();
    var dStr = mustString_(d).trim();
    if (eStr) {
      out.push([a, b, c, d, e]);
      continue;
    }
    if (!dStr) {
      out.push([a, b, c, "", ""]);
      continue;
    }
    if (!looksLikeLegacyBikouInD_(dStr)) {
      out.push([a, b, c, dStr, ""]);
      continue;
    }
    var kanjou = extractKanjouFromSummaryCell_(b) || "その他";
    out.push([a, b, c, kanjou, dStr]);
    changed++;
  }
  sheet.getRange(2, 1, numRows, 5).setValues(
    out.map(function (row) {
      return row.slice(0, 5);
    })
  );
  return changed;
}

function ensureKanjouSheetHeaders_(sheet) {
  var a1 = mustString_(sheet.getRange(1, 1).getValue());
  if (a1 !== "日付" && !/^date$/i.test(a1)) return;
  sheet
    .getRange(1, 1, 1, 5)
    .setValues([["日付", "概要", "金額", "勘定科目", "備考"]]);
}

/** 家計簿・医療・塾・ペットの旧 D 列（備考）を E 列へ移す */
function migrateAllLegacyColumnDToE_() {
  var spreadsheetId = getProps_().spreadsheetId;
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var report = [];
  SHEETS_WITH_KANJOU_COL.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    ensureKanjouSheetHeaders_(sh);
    var n = migrateLegacyColumnDToE_(sh);
    if (n > 0) report.push({ sheet: name, rows: n });
  });
  return report;
}

/** 家計簿・医療・塾関係・ペット・行動ログをまとめて古い順に並べ替え */
function sortAllSheetsByDateAsc_() {
  var spreadsheetId = getProps_().spreadsheetId;
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sorted = [];
  SHEETS_SORT_DATE_ASC.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var n = sortSheetByDateAsc_(sh, sheetDataColumnCount_(name));
    if (n > 0) sorted.push({ sheet: name, rows: n });
  });
  return sorted;
}

/** スプレッドシートを開いたときのメニュー */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("記録ノート")
    .addItem("備考をE列へ移行（旧D列）", "menuMigrateLegacyColumnDToE_")
    .addItem("日付で並べ替え（古い順）", "menuSortAllSheetsByDateAsc_")
    .addToUi();
}

function menuMigrateLegacyColumnDToE_() {
  var report = migrateAllLegacyColumnDToE_();
  var msg =
    report.length === 0
      ? "移行した行はありませんでした（すでにE列にあるか、D列が空です）。"
      : "旧D列の備考をE列へ移しました。\n" +
        report
          .map(function (x) {
            return "・" + x.sheet + "（" + x.rows + "行）";
          })
          .join("\n");
  SpreadsheetApp.getUi().alert(msg);
}

function menuSortAllSheetsByDateAsc_() {
  var sorted = sortAllSheetsByDateAsc_();
  var msg =
    sorted.length === 0
      ? "並べ替えるデータ行がありませんでした。"
      : "日付の古い順に並べ替えました。\n" +
        sorted
          .map(function (x) {
            return "・" + x.sheet + "（" + x.rows + "行）";
          })
          .join("\n");
  SpreadsheetApp.getUi().alert(msg);
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
  if (analysis.category === "pet") {
    var cPet = asNumber_(f.cost);
    if (cPet > 0) return cPet;
    var aPet = asNumber_(f.amount);
    if (aPet > 0) return aPet;
    var petText =
      mustString_(analysis.summary) +
      " " +
      mustString_(f.content) +
      " " +
      mustString_(f.hospital) +
      " " +
      mustString_(f.bikou) +
      " " +
      mustString_(f.memo);
    return extractYenFromSummary_(petText);
  }
  return 0;
}

/** 家計簿のとき、fields.category または summary の接頭辞で別タブへ */
function resolveSheetName_(analysis) {
  if (analysis.category === "pet") return SHEET_NAMES.pet;
  if (analysis.category === "log") return SHEET_NAMES.log;
  if (analysis.category === "meal") return SHEET_NAMES.meal;
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
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const { spreadsheetId } = getProps_();
    const ss = SpreadsheetApp.openById(spreadsheetId);
    var sheetName = resolveSheetName_(analysis);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error(`タブ「${sheetName}」が見つかりません`);
    var numCols = sheetDataColumnCount_(sheetName);

    var row;
    if (analysis.category === "kakeibo") {
      var fin = normalizeKakeiboRowForSheet_(analysis);
      var amtK = fin.amount > 0 ? Number(fin.amount) : 0;
      row = [
        analysis.date,
        briefSummaryForSheet_(fin.summary),
        amtK,
        kanjouKamokuForSheet_(analysis, fin),
        fin.bikou,
      ];
    } else if (analysis.category === "pet") {
      var amtP = amountFromAnalysis_(analysis);
      row = [
        analysis.date,
        briefSummaryForSheet_(mustString_(analysis.summary)),
        amtP > 0 ? Number(amtP) : 0,
        kanjouKamokuForSheet_(analysis, null),
        bikouFromAnalysis_(analysis),
      ];
    } else if (analysis.category === "log") {
      row = [
        analysis.date,
        briefSummaryForSheet_(mustString_(analysis.summary)),
        logTimeColumnC_(analysis),
        logRemarksColumnD_(analysis),
      ];
    } else if (analysis.category === "meal") {
      // 同日にすでに合計行がある場合、追加の前にいったん消す（最後に付け直す）
      deleteTrailingMealTotalRowIfAny_(sheet, analysis.date);
      row = [
        analysis.date,
        briefSummaryForSheet_(mustString_(analysis.summary)),
        mealCaloriesColumnC_(analysis),
        mealRemarksColumnD_(analysis),
      ];
    } else {
      throw new Error("category が不正です");
    }

    if (isDuplicateOfRecentRows_(sheet, row, 5, numCols)) {
      return { deduped: true };
    }
    sheet.appendRow(row);
    if (analysis.category === "meal") {
      appendMealDailyTotalRow_(sheet, analysis.date);
    } else if (shouldAutoSortSheet_(sheetName)) {
      sortSheetByDateAsc_(sheet, numCols);
    }
    return { deduped: false };
  } finally {
    lock.releaseLock();
  }
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
    { key: "meal", label: "食事" },
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
    var colCount = sheetDataColumnCount_(sheetName);
    const values = sheet.getRange(startRow, 1, numRows, colCount).getValues();
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
    if (action === "sortByDateAsc") {
      var sr = sortAllSheetsByDateAsc_();
      return jsonOut_({ ok: true, sorted: sr });
    }
    if (action === "migrateLegacyDToE") {
      var mr = migrateAllLegacyColumnDToE_();
      return jsonOut_({ ok: true, migrated: mr });
    }
    return errorOut_("action が不正です", 400);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return errorOut_(msg, 500);
  }
}

