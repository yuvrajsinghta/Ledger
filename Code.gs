/**
 * LEDGER — Google Sheets Backend
 * ---------------------------------------------------------
 * SETUP (one-time):
 * 1. Open a Google Sheet (create a new blank one) — this is where the data will be saved.
 * 2. Go to Extensions > Apps Script.
 * 3. Delete the default code (Code.gs) and paste this entire file in its place.
 * 4. Click "Save" (💾 icon) at the top.
 * 5. Click "Deploy" > "New deployment".
 *    - Click the gear icon (⚙️) and select "Web app".
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"
 *    - Click "Deploy" and allow the requested Google permissions.
 * 6. Copy the generated URL (....../exec) and paste it into the
 *    SCRIPT_URL constant in the app's app.js file. That's it — connected!
 *
 * This script manages TWO tabs in the same spreadsheet:
 *   - "Ledger Entries" — daily cash in / cash out
 *   - "Dues Entries"  — pending amounts to receive / to pay
 * Both format themselves automatically (headers, colors, column widths)
 * the first time any entry is added.
 * ---------------------------------------------------------
 */

const LEDGER_SHEET_NAME = "Ledger Entries";
const LEDGER_HEADERS = ["ID", "Type", "Amount", "Person", "Date", "Time", "Mode", "Note", "Created At", "Updated At"];

const DUES_SHEET_NAME = "Dues Entries";
const DUES_HEADERS = ["ID", "Kind", "Amount", "Person", "Date", "Note", "Settled", "Settled Date", "Created At", "Updated At"];

/* ---------------- Sheet setup / formatting ---------------- */
function getSheet_(sheetName, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    formatSheet_(sheet, headers);
  }
  if (sheet.getRange(1, 1).getValue() !== headers[0]) {
    formatSheet_(sheet, headers);
  }
  return sheet;
}

function formatSheet_(sheet, headers) {
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange
    .setBackground("#0C1120")
    .setFontColor("#7FAAFF")
    .setFontWeight("bold")
    .setFontSize(11)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 32);

  const widths = headers.map((h, i) => (i === 3 ? 180 : i >= headers.length - 2 ? 170 : 100));
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  sheet.getRange(2, 3, sheet.getMaxRows() - 1, 1).setNumberFormat("₹#,##0.00");

  const existingBandings = sheet.getBandings();
  existingBandings.forEach(b => b.remove());
  const range = sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 50), headers.length);
  range.applyRowBanding(SpreadsheetApp.BandingTheme.CYAN, true, false)
    .setHeaderRowColor("#0C1120")
    .setFirstRowColor("#FFFFFF")
    .setSecondRowColor("#F1F4FA");

  try {
    const dataRange = sheet.getRange(1, 1, 1, headers.length);
    if (!sheet.getFilter()) dataRange.createFilter();
  } catch (err) {
    // ignore if filter already exists
  }
}

/* ---------------- Ledger row <-> entry mapping ---------------- */
function ledgerRowToEntry_(row) {
  return {
    id: row[0], type: row[1], amount: row[2], person: row[3], date: row[4],
    time: row[5], mode: row[6], note: row[7], createdAt: row[8], updatedAt: row[9]
  };
}
function ledgerEntryToRow_(entry) {
  return [
    entry.id, entry.type, entry.amount, entry.person, entry.date, entry.time, entry.mode,
    entry.note || "", entry.createdAt || new Date().toISOString(), entry.updatedAt || new Date().toISOString()
  ];
}

/* ---------------- Dues row <-> entry mapping ---------------- */
function duesRowToEntry_(row) {
  return {
    id: row[0], kind: row[1], amount: row[2], person: row[3], date: row[4],
    note: row[5], settled: row[6] === true || row[6] === "TRUE" || row[6] === "Yes",
    settledDate: row[7], createdAt: row[8], updatedAt: row[9]
  };
}
function duesEntryToRow_(entry) {
  return [
    entry.id, entry.kind, entry.amount, entry.person, entry.date, entry.note || "",
    entry.settled ? "Yes" : "No", entry.settledDate || "",
    entry.createdAt || new Date().toISOString(), entry.updatedAt || new Date().toISOString()
  ];
}

/* ---------------- GET — return all entries as JSON ---------------- */
function doGet(e) {
  const type = (e.parameter && e.parameter.type) || "ledger";

  if (type === "dues") {
    const sheet = getSheet_(DUES_SHEET_NAME, DUES_HEADERS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return jsonOut_([]);
    const data = sheet.getRange(2, 1, lastRow - 1, DUES_HEADERS.length).getValues();
    return jsonOut_(data.filter(row => row[0] !== "").map(duesRowToEntry_));
  }

  const sheet = getSheet_(LEDGER_SHEET_NAME, LEDGER_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOut_([]);
  const data = sheet.getRange(2, 1, lastRow - 1, LEDGER_HEADERS.length).getValues();
  return jsonOut_(data.filter(row => row[0] !== "").map(ledgerRowToEntry_));
}

/* ---------------- POST — add / edit / delete ---------------- */
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: "Invalid JSON" });
  }

  const sheetType = body.sheetType || "ledger";
  const action = body.action;
  const entry = body.entry;

  if (sheetType === "dues") {
    const sheet = getSheet_(DUES_SHEET_NAME, DUES_HEADERS);

    if (action === "add") {
      sheet.appendRow(duesEntryToRow_(entry));
      reapplyAmountFormat_(sheet);
      return jsonOut_({ ok: true });
    }
    if (action === "edit") {
      const rowIndex = findRowById_(sheet, entry.id);
      if (rowIndex > -1) sheet.getRange(rowIndex, 1, 1, DUES_HEADERS.length).setValues([duesEntryToRow_(entry)]);
      else sheet.appendRow(duesEntryToRow_(entry));
      reapplyAmountFormat_(sheet);
      return jsonOut_({ ok: true });
    }
    if (action === "delete") {
      const rowIndex = findRowById_(sheet, entry.id);
      if (rowIndex > -1) sheet.deleteRow(rowIndex);
      return jsonOut_({ ok: true });
    }
    return jsonOut_({ ok: false, error: "Unknown action" });
  }

  // Default: ledger
  const sheet = getSheet_(LEDGER_SHEET_NAME, LEDGER_HEADERS);

  if (action === "add") {
    sheet.appendRow(ledgerEntryToRow_(entry));
    reapplyAmountFormat_(sheet);
    return jsonOut_({ ok: true });
  }
  if (action === "edit") {
    const rowIndex = findRowById_(sheet, entry.id);
    if (rowIndex > -1) sheet.getRange(rowIndex, 1, 1, LEDGER_HEADERS.length).setValues([ledgerEntryToRow_(entry)]);
    else sheet.appendRow(ledgerEntryToRow_(entry));
    reapplyAmountFormat_(sheet);
    return jsonOut_({ ok: true });
  }
  if (action === "delete") {
    const rowIndex = findRowById_(sheet, entry.id);
    if (rowIndex > -1) sheet.deleteRow(rowIndex);
    return jsonOut_({ ok: true });
  }
  return jsonOut_({ ok: false, error: "Unknown action" });
}

function findRowById_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

function reapplyAmountFormat_(sheet) {
  sheet.getRange(2, 3, Math.max(sheet.getLastRow() - 1, 1), 1).setNumberFormat("₹#,##0.00");
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- Optional: run once manually to pre-format both sheets ---------------- */
function setupSheetsManually() {
  formatSheet_(getSheet_(LEDGER_SHEET_NAME, LEDGER_HEADERS), LEDGER_HEADERS);
  formatSheet_(getSheet_(DUES_SHEET_NAME, DUES_HEADERS), DUES_HEADERS);
}
