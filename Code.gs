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
 * The sheet formats itself automatically (headers, colors, column widths)
 * the first time any entry is added.
 * ---------------------------------------------------------
 */

const SHEET_NAME = "Ledger Entries";
const HEADERS = ["ID", "Type", "Amount", "Person", "Date", "Time", "Mode", "Note", "Created At", "Updated At"];

/* ---------------- Sheet setup / formatting ---------------- */
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    formatSheet_(sheet);
  }
  if (sheet.getRange(1, 1).getValue() !== "ID") {
    formatSheet_(sheet);
  }
  return sheet;
}

function formatSheet_(sheet) {
  sheet.clear();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange
    .setBackground("#0C1120")
    .setFontColor("#7FAAFF")
    .setFontWeight("bold")
    .setFontSize(11)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 32);

  const widths = [160, 70, 100, 180, 100, 90, 90, 220, 170, 170];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // Amount column number format
  sheet.getRange(2, 3, sheet.getMaxRows() - 1, 1).setNumberFormat("₹#,##0.00");

  // Banding (alternating row colors) for readability
  const existingBandings = sheet.getBandings();
  existingBandings.forEach(b => b.remove());
  const range = sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 50), HEADERS.length);
  range.applyRowBanding(SpreadsheetApp.BandingTheme.CYAN, true, false)
    .setHeaderRowColor("#0C1120")
    .setFirstRowColor("#FFFFFF")
    .setSecondRowColor("#F1F4FA");

  sheet.setFilterOffset ? null : null; // safeguard, some old API diffs
  try {
    const dataRange = sheet.getRange(1, 1, 1, HEADERS.length);
    if (!sheet.getFilter()) dataRange.createFilter();
  } catch (err) {
    // ignore if filter already exists
  }
}

/* ---------------- Row <-> Entry mapping ---------------- */
function rowToEntry_(row) {
  return {
    id: row[0],
    type: row[1],
    amount: row[2],
    person: row[3],
    date: row[4],
    time: row[5],
    mode: row[6],
    note: row[7],
    createdAt: row[8],
    updatedAt: row[9]
  };
}
function entryToRow_(entry) {
  return [
    entry.id,
    entry.type,
    entry.amount,
    entry.person,
    entry.date,
    entry.time,
    entry.mode,
    entry.note || "",
    entry.createdAt || new Date().toISOString(),
    entry.updatedAt || new Date().toISOString()
  ];
}

/* ---------------- GET — return all entries as JSON ---------------- */
function doGet(e) {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return jsonOut_([]);
  }
  const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  const entries = data
    .filter(row => row[0] !== "")
    .map(rowToEntry_);
  return jsonOut_(entries);
}

/* ---------------- POST — add / edit / delete ---------------- */
function doPost(e) {
  const sheet = getSheet_();
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: "Invalid JSON" });
  }

  const action = body.action;
  const entry = body.entry;

  if (action === "add") {
    sheet.appendRow(entryToRow_(entry));
    reapplyAmountFormat_(sheet);
    return jsonOut_({ ok: true });
  }

  if (action === "edit") {
    const rowIndex = findRowById_(sheet, entry.id);
    if (rowIndex > -1) {
      sheet.getRange(rowIndex, 1, 1, HEADERS.length).setValues([entryToRow_(entry)]);
    } else {
      sheet.appendRow(entryToRow_(entry));
    }
    reapplyAmountFormat_(sheet);
    return jsonOut_({ ok: true });
  }

  if (action === "delete") {
    const rowIndex = findRowById_(sheet, entry.id);
    if (rowIndex > -1) {
      sheet.deleteRow(rowIndex);
    }
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

/* ---------------- Optional: run once manually to pre-format an empty sheet ---------------- */
function setupSheetManually() {
  formatSheet_(getSheet_());
}
