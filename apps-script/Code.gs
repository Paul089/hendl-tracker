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

const REFERENCE_SHEET_NAME = "Referenz";
// Columns: Wochentag | Zeit | Hendlspieße | Entenspieße
// One row per time-of-day with the historical average current-on-grill
// count for that weekday, filled in by hand. Read (GET) by the app's
// comparison graph, filtered to today's weekday.

const YEAR_SHEET_PATTERN = /^\d{4}$/;
// A sheet named e.g. "2024" holds that season's actual readings, same
// shape as "Log" minus the ID column: Date | Time | Type | Quantity.
// Filled in by hand for seasons before this app existed, or produced by
// the "Season abschließen" menu action (see archiveLogToYearSheet_)
// at the end of a season that used the live app.

function doGet(e) {
  const params = (e && e.parameter) || {};

  if (params.years) {
    return jsonOutput_(getYearSheetNames_());
  }

  if (params.source && YEAR_SHEET_PATTERN.test(params.source)) {
    return jsonOutput_(getYearSheetRows_(params.source, (params.weekday || "").trim()));
  }

  const weekday = (params.weekday || "").trim();
  const sheet = getReferenceSheet_();
  const lastRow = sheet.getLastRow();
  const rows = [];

  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    for (const [rowWeekday, time, hendl, ente] of values) {
      if (weekday && String(rowWeekday).trim() !== weekday) continue;
      rows.push({
        time: formatReferenceTime_(time),
        hendl: hendl === "" ? null : Number(hendl),
        ente: ente === "" ? null : Number(ente),
      });
    }
  }

  return jsonOutput_(rows);
}

function jsonOutput_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

// Returns names of all sheet tabs that look like a year ("2024", "2025",
// ...), sorted newest first, so the app can build its year picker without
// any hardcoded list.
function getYearSheetNames_() {
  return SpreadsheetApp.getActiveSpreadsheet()
    .getSheets()
    .map((s) => s.getName())
    .filter((name) => YEAR_SHEET_PATTERN.test(name))
    .sort((a, b) => Number(b) - Number(a));
}

// Reads a year sheet (Date | Time | Type | Quantity) and returns a flat
// list of {time, type, quantity}, optionally filtered to rows whose Date
// falls on the given weekday (computed here, since year sheets store a
// real date rather than a weekday name like Referenz does).
function getYearSheetRows_(year, weekday) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(year);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const rows = [];
  for (const [date, time, type, quantity] of values) {
    if (!type || quantity === "") continue;
    if (weekday && rowWeekday_(date) !== weekday) continue;
    rows.push({
      time: formatReferenceTime_(time),
      type: String(type).trim(),
      quantity: Number(quantity),
    });
  }
  rows.sort((a, b) => a.time.localeCompare(b.time));
  return rows;
}

const WEEKDAY_NAMES_ = [
  "Sonntag", "Montag", "Dienstag", "Mittwoch",
  "Donnerstag", "Freitag", "Samstag",
];

function rowWeekday_(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return WEEKDAY_NAMES_[d.getDay()];
}

function formatReferenceTime_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "HH:mm");
  }
  return String(value);
}

function getReferenceSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(REFERENCE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(REFERENCE_SHEET_NAME);
    sheet.appendRow(["Wochentag", "Zeit", "Hendlspieße", "Entenspieße"]);
  }
  return sheet;
}

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

// ---- Season archiving (run by hand from the Sheets UI, never by the web
// app) -------------------------------------------------------------
// Copies this season's Log rows into a new year sheet (Date, Time, Type,
// Quantity, ID column dropped) so they become available in the app's
// year-comparison picker next season, then optionally clears Log so it
// starts the next season empty.

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Grill Tracker")
    .addItem("Season abschliessen: Log archivieren", "archiveLogToYearSheet_")
    .addToUi();
}

function archiveLogToYearSheet_() {
  const ui = SpreadsheetApp.getUi();
  const logSheet = getLogSheet_();
  const lastRow = logSheet.getLastRow();

  if (lastRow < 2) {
    ui.alert("Log enthaelt keine Eintraege zum Archivieren.");
    return;
  }

  const values = logSheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const defaultYear = guessYear_(values) || String(new Date().getFullYear());

  const yearResponse = ui.prompt(
    "Season abschliessen",
    "Log-Daten in welches Jahr archivieren? (" + values.length + " Zeilen, Vorschlag: " + defaultYear + ")",
    ui.ButtonSet.OK_CANCEL
  );
  if (yearResponse.getSelectedButton() !== ui.Button.OK) return;

  const year = (yearResponse.getResponseText() || defaultYear).trim() || defaultYear;
  if (!YEAR_SHEET_PATTERN.test(year)) {
    ui.alert("\"" + year + "\" ist keine gueltige vierstellige Jahreszahl.");
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let yearSheet = ss.getSheetByName(year);

  if (yearSheet) {
    const overwrite = ui.alert(
      "Jahr existiert bereits",
      "Ein Tab \"" + year + "\" existiert schon. Log-Daten anhaengen?",
      ui.ButtonSet.YES_NO
    );
    if (overwrite !== ui.Button.YES) return;
  } else {
    yearSheet = ss.insertSheet(year);
    yearSheet.appendRow(["Date", "Time", "Type", "Quantity"]);
  }

  yearSheet.getRange(yearSheet.getLastRow() + 1, 1, values.length, 4).setValues(values);

  const clearResponse = ui.alert(
    "Log leeren?",
    "Log-Eintraege jetzt loeschen, um die naechste Season leer zu starten?",
    ui.ButtonSet.YES_NO
  );
  if (clearResponse === ui.Button.YES) {
    logSheet.getRange(2, 1, lastRow - 1, 5).clearContent();
  }

  ui.alert(values.length + " Zeilen nach \"" + year + "\" archiviert.");
}

// Best-effort guess at the season's year from the Log rows' Date column,
// used only to pre-fill the archive prompt.
function guessYear_(values) {
  for (const row of values) {
    const date = row[0];
    const d = date instanceof Date ? date : new Date(date);
    if (!isNaN(d.getTime())) return String(d.getFullYear());
  }
  return "";
}
