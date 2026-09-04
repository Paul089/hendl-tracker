// Google Apps Script Web App — receives POSTs from the Grill Tracker
// app and appends/removes rows in the "Log" sheet.
//
// Setup: see README.md for full click-by-click instructions.
// 1. Create a Google Sheet.
// 2. Extensions -> Apps Script, delete the default content, paste this file.
// 3. Deploy -> New deployment -> Web app.
//      Execute as: Me
//      Who has access: Anyone
// 4. Copy the resulting URL into CONFIG.scriptUrl in app.js.
//
// Idempotent by design: the app retries adds/deletes automatically
// (see flushQueue in app.js) whenever a request might not have gotten
// through, so every write here is safe to receive more than once for
// the same entry ID.

const SHEET_NAME = "Log";
// Columns: Date | Time | Type | Quantity | ID
const ID_COLUMN = 5;

function doPost(e) {
  // Serialize concurrent requests so two near-simultaneous taps can't
  // both read the same "last row" and clobber each other.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getLogSheet_();
    const data = JSON.parse(e.postData.contents);

    if (data.action === "delete") {
      deleteRowById_(sheet, data.id);
    } else {
      addRowIfNew_(sheet, data);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function addRowIfNew_(sheet, data) {
  if (findRowById_(sheet, data.id) !== -1) return; // already logged, skip

  const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
  const date = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const time = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "HH:mm:ss");

  sheet.appendRow([date, time, data.type, data.quantity, data.id]);
}

function deleteRowById_(sheet, id) {
  const row = findRowById_(sheet, id);
  if (row !== -1) sheet.deleteRow(row);
}

// Returns the 1-based sheet row for a given entry ID, or -1 if not found.
function findRowById_(sheet, id) {
  if (!id) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const ids = sheet.getRange(2, ID_COLUMN, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2; // +2: header row + 1-based index
  }
  return -1;
}

function getLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["Date", "Time", "Type", "Quantity", "ID"]);
  }
  return sheet;
}
