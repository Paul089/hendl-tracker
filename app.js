// ---- Configuration -------------------------------------------------
// Paste the Google Apps Script Web App URL here after deploying
// apps-script/Code.gs (see README.md for step-by-step instructions).
const CONFIG = {
  scriptUrl: "https://script.google.com/macros/s/AKfycbx4Iupr99k51a_-sqK5mAF4qmgNp3r1FuEa2XMwPQiisqqQ3IKCcTGjxD5BQ2IEGEo1fA/exec",
};

const APP_PIN = "1855";
const PIN_UNLOCK_KEY = "grillTracker.pinUnlocked";

// ---- State -----------------------------------------------------------
const STORAGE_KEY = "grillTracker.entries";
const PENDING_DELETES_KEY = "grillTracker.pendingDeletes";
const SYNC_INTERVAL_MS = 15000;

let pendingType = null;
let keypadValue = "";
let pinValue = "";
let confirmingDeleteId = null;
let confirmDeleteTimer = null;

const els = {
  pinOverlay: document.getElementById("pin-overlay"),
  pinDisplay: document.getElementById("pin-display"),
  pinError: document.getElementById("pin-error"),
  keypadOverlay: document.getElementById("keypad-overlay"),
  keypadDisplay: document.getElementById("keypad-display"),
  keypadTitle: document.getElementById("keypad-title"),
  keypadEmoji: document.getElementById("keypad-emoji"),
  keypadConfirm: document.getElementById("keypad-confirm"),
  keypadCancel: document.getElementById("keypad-cancel"),
  totalHendl: document.getElementById("total-hendl"),
  totalEnte: document.getElementById("total-ente"),
  recentList: document.getElementById("recent-list"),
  toast: document.getElementById("toast"),
  syncStatus: document.getElementById("sync-status"),
  graphOpen: document.getElementById("graph-open"),
  graphOverlay: document.getElementById("graph-overlay"),
  graphClose: document.getElementById("graph-close"),
  graphCanvas: document.getElementById("graph-canvas"),
  graphStatus: document.getElementById("graph-status"),
  graphSourceToggle: document.getElementById("graph-source-toggle"),
  legendReferenceLabel: document.getElementById("legend-reference-label"),
};

// ---- PIN lock ----------------------------------------------------------
if (localStorage.getItem(PIN_UNLOCK_KEY) === "true") {
  els.pinOverlay.classList.add("hidden");
}

function updatePinDisplay() {
  els.pinDisplay.textContent = "•".repeat(pinValue.length) + "-".repeat(4 - pinValue.length);
}

document.querySelectorAll("#pin-overlay .key").forEach((key) => {
  key.addEventListener("click", () => {
    const k = key.dataset.key;
    if (k === "clear") pinValue = "";
    else if (k === "back") pinValue = pinValue.slice(0, -1);
    else if (pinValue.length < 4) pinValue += k;

    updatePinDisplay();
    els.pinError.classList.add("hidden");

    if (pinValue.length === 4) {
      if (pinValue === APP_PIN) {
        localStorage.setItem(PIN_UNLOCK_KEY, "true");
        els.pinOverlay.classList.add("hidden");
      } else {
        els.pinError.classList.remove("hidden");
        setTimeout(() => {
          pinValue = "";
          updatePinDisplay();
        }, 500);
      }
    }
  });
});

const EMOJI = { hendl: "🐔", ente: "🦆" };

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Local "today" log (source of truth for the on-screen summary;
// every add/delete is also queued for delivery to the Sheet below) ------
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function loadEntries() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return raw.day === todayKey() ? raw.entries : [];
  } catch {
    return [];
  }
}

function saveEntries(entries) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ day: todayKey(), entries })
  );
}

function loadPendingDeletes() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_DELETES_KEY) || "[]");
  } catch {
    return [];
  }
}

function savePendingDeletes(ids) {
  localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(ids));
}

let entries = loadEntries();
let pendingDeletes = loadPendingDeletes();
let currentDay = todayKey();

// If the app is left open across midnight (e.g. a multi-day festival),
// this catches the date change without needing a page reload. Only the
// on-screen "today" summary resets — nothing is ever removed from the
// Google Sheet, which stays a complete permanent log.
function checkDayRollover() {
  const today = todayKey();
  if (today === currentDay) return;
  currentDay = today;
  entries = [];
  saveEntries(entries);
  renderSummary();
}

// Each entry is a live reading of how many skewers are currently on the
// grill (not an addition), so the summary shows the most recent reading
// per type rather than a sum. Entries are always appended chronologically,
// so the last one seen for a type is the latest.
function renderSummary() {
  const current = { hendl: 0, ente: 0 };
  for (const e of entries) current[e.type] = e.quantity;
  els.totalHendl.textContent = current.hendl;
  els.totalEnte.textContent = current.ente;

  const pendingCount = entries.filter((e) => !e.synced).length + pendingDeletes.length;
  if (pendingCount === 0) {
    els.syncStatus.textContent = "✓ Synced to Sheet";
    els.syncStatus.classList.remove("pending");
  } else {
    els.syncStatus.textContent = `⏳ ${pendingCount} pending sync`;
    els.syncStatus.classList.add("pending");
  }

  els.recentList.innerHTML = "";
  entries
    .slice(-8)
    .reverse()
    .forEach((e) => {
      const li = document.createElement("li");
      li.dataset.id = e.id;
      const time = new Date(e.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const confirming = e.id === confirmingDeleteId;
      li.innerHTML = `
        <span class="entry-info">
          <span>${EMOJI[e.type]} ${e.quantity} aktuell${e.synced ? "" : " <span class=\"unsynced-dot\" title=\"Not yet synced\"></span>"}</span>
          <span class="entry-time">${time}</span>
        </span>
        <button class="delete-entry${confirming ? " confirming" : ""}" aria-label="${confirming ? "Confirm delete" : "Delete entry"}" data-id="${e.id}">${confirming ? "Confirm?" : "✕"}</button>
      `;
      els.recentList.appendChild(li);
    });
}

// ---- Toast -------------------------------------------------------------
let toastTimer = null;
function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle("error", isError);
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 2200);
}

// ---- Keypad --------------------------------------------------------
function openKeypad(type, label) {
  pendingType = type;
  keypadValue = "";
  els.keypadTitle.textContent = label;
  els.keypadEmoji.textContent = EMOJI[type];
  els.keypadDisplay.textContent = "0";
  els.keypadOverlay.classList.remove("hidden");
}

function closeKeypad() {
  els.keypadOverlay.classList.add("hidden");
  pendingType = null;
  keypadValue = "";
}

function updateDisplay() {
  els.keypadDisplay.textContent = keypadValue === "" ? "0" : keypadValue;
}

document.querySelectorAll(".animal-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    openKeypad(btn.dataset.type, btn.dataset.label);
  });
});

document.querySelectorAll("#keypad-overlay .key").forEach((key) => {
  key.addEventListener("click", () => {
    const k = key.dataset.key;
    if (k === "clear") {
      keypadValue = "";
    } else if (k === "back") {
      keypadValue = keypadValue.slice(0, -1);
    } else {
      if (keypadValue.length < 4) keypadValue += k;
    }
    updateDisplay();
  });
});

els.keypadCancel.addEventListener("click", closeKeypad);

els.keypadConfirm.addEventListener("click", () => {
  const quantity = parseInt(keypadValue, 10);
  if (!quantity || quantity <= 0) {
    showToast("Enter a quantity first", true);
    return;
  }

  const entry = {
    id: makeId(),
    type: pendingType,
    quantity,
    timestamp: new Date().toISOString(),
    synced: false,
  };

  entries.push(entry);
  saveEntries(entries);
  renderSummary();
  closeKeypad();
  showToast(`${EMOJI[entry.type]} ${quantity} aktuell ✓`);

  flushQueue();
});

// Tapping the dark overlay background (outside the panel) cancels
els.keypadOverlay.addEventListener("click", (e) => {
  if (e.target === els.keypadOverlay) closeKeypad();
});

// ---- Delete an entry -------------------------------------------------
els.recentList.addEventListener("click", (e) => {
  const btn = e.target.closest(".delete-entry");
  if (!btn) return;

  const id = btn.dataset.id;
  const entry = entries.find((en) => en.id === id);
  if (!entry) return;

  // First tap arms the entry ("Confirm?"); a second tap within 3s deletes it.
  if (confirmingDeleteId !== id) {
    confirmingDeleteId = id;
    clearTimeout(confirmDeleteTimer);
    confirmDeleteTimer = setTimeout(() => {
      confirmingDeleteId = null;
      renderSummary();
    }, 3000);
    renderSummary();
    return;
  }

  clearTimeout(confirmDeleteTimer);
  confirmingDeleteId = null;

  entries = entries.filter((en) => en.id !== id);
  saveEntries(entries);

  // Always queue the delete, even if the add never synced — deleteRowById_
  // in Code.gs is a no-op for an ID that isn't in the sheet, so this is safe.
  pendingDeletes.push(id);
  savePendingDeletes(pendingDeletes);

  renderSummary();
  showToast("Entry deleted");
  flushQueue();
});

// ---- Sync to Google Sheet -------------------------------------------
// Apps Script Web Apps don't reliably return CORS headers, so we send
// with mode:"no-cors" and can't read a real success/failure response.
// To stay robust despite that, every entry carries a stable ID and the
// Apps Script side (apps-script/Code.gs) is idempotent — retrying an
// add or delete that already landed is a safe no-op, never a duplicate.
async function postToSheet(action, payload) {
  if (!CONFIG.scriptUrl || CONFIG.scriptUrl.startsWith("PASTE_")) {
    throw new Error("Apps Script URL not configured yet (see README.md)");
  }
  await fetch(CONFIG.scriptUrl, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
  });
}

let flushing = false;
async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    for (const entry of entries.filter((e) => !e.synced)) {
      try {
        await postToSheet("add", entry);
        entry.synced = true;
        saveEntries(entries);
        renderSummary();
      } catch {
        break; // likely offline — stop and let the next scheduled flush retry
      }
    }

    for (const id of [...pendingDeletes]) {
      try {
        await postToSheet("delete", { id });
        pendingDeletes = pendingDeletes.filter((pid) => pid !== id);
        savePendingDeletes(pendingDeletes);
        renderSummary();
      } catch {
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

window.addEventListener("online", flushQueue);
setInterval(flushQueue, SYNC_INTERVAL_MS);

// ---- Comparison graph ---------------------------------------------------
// Shows today's current-amount readings against a historical average for
// today's weekday, so the pit master can spot "we're behind where we
// usually are by now" and hang more in time. Purely a nice-to-have: any
// failure here (offline, no Referenz tab yet) must never affect logging.
const REFERENCE_CACHE_KEY = "grillTracker.referenceCache";
const WEEKDAYS = [
  "Sonntag", "Montag", "Dienstag", "Mittwoch",
  "Donnerstag", "Freitag", "Samstag",
];
const TYPE_COLOR = { hendl: "#f4a13a", ente: "#4a90c4" };

let graphType = "hendl";
let graphSource = "average";
let graphYears = [];
let graphReferenceRows = null;

function todayWeekday() {
  return WEEKDAYS[new Date().getDay()];
}

function timeToMinutes(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}

async function fetchReference(source) {
  const weekday = todayWeekday();
  const cacheKey = `${todayKey()}|${weekday}|${source}`;
  const url =
    source === "average"
      ? `${CONFIG.scriptUrl}?weekday=${encodeURIComponent(weekday)}`
      : `${CONFIG.scriptUrl}?source=${encodeURIComponent(source)}&weekday=${encodeURIComponent(weekday)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("bad response");
    const rows = await res.json();
    localStorage.setItem(REFERENCE_CACHE_KEY, JSON.stringify({ key: cacheKey, rows }));
    return rows;
  } catch {
    try {
      const cached = JSON.parse(localStorage.getItem(REFERENCE_CACHE_KEY) || "null");
      if (cached && cached.key === cacheKey) return cached.rows;
    } catch {
      // ignore corrupt cache
    }
    return null;
  }
}

// Years are auto-discovered from the spreadsheet (any tab named as a
// 4-digit year), cached so a flaky request while opening the graph
// doesn't just leave the picker showing only "Durchschnitt".
const YEARS_CACHE_KEY = "grillTracker.yearsCache";

async function fetchYearList() {
  try {
    const res = await fetch(`${CONFIG.scriptUrl}?years=1`);
    if (!res.ok) throw new Error("bad response");
    const years = await res.json();
    localStorage.setItem(YEARS_CACHE_KEY, JSON.stringify(years));
    return years;
  } catch {
    try {
      return JSON.parse(localStorage.getItem(YEARS_CACHE_KEY) || "[]");
    } catch {
      return [];
    }
  }
}

function seriesFromEntries(type) {
  return entries
    .filter((e) => e.type === type)
    .map((e) => {
      const d = new Date(e.timestamp);
      return { minutes: d.getHours() * 60 + d.getMinutes(), value: e.quantity };
    })
    .sort((a, b) => a.minutes - b.minutes);
}

function seriesFromReference(type) {
  return (graphReferenceRows || [])
    .map((r) => ({ minutes: timeToMinutes(r.time), value: r[type] }))
    .filter((r) => Number.isFinite(r.minutes) && Number.isFinite(r.value))
    .sort((a, b) => a.minutes - b.minutes);
}

// Year sheets return flat {time, type, quantity} rows (one type per row,
// unlike Referenz's wide format) — same shape as local entries, so this
// mirrors seriesFromEntries.
function seriesFromYearRows(type) {
  return (graphReferenceRows || [])
    .filter((r) => r.type === type)
    .map((r) => ({ minutes: timeToMinutes(r.time), value: r.quantity }))
    .filter((r) => Number.isFinite(r.minutes) && Number.isFinite(r.value))
    .sort((a, b) => a.minutes - b.minutes);
}

function buildReferenceSeries(type) {
  return graphSource === "average" ? seriesFromReference(type) : seriesFromYearRows(type);
}

function renderGraph() {
  drawChart(els.graphCanvas, buildReferenceSeries(graphType), seriesFromEntries(graphType), graphType);
}

function drawChart(canvas, referenceSeries, actualSeries, type) {
  const wrap = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w === 0 || h === 0) return;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const allPoints = [...referenceSeries, ...actualSeries];
  if (allPoints.length === 0) {
    ctx.fillStyle = "rgba(245,245,245,0.5)";
    ctx.font = "14px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Noch keine Daten", w / 2, h / 2);
    return;
  }

  const pad = { top: 16, right: 16, bottom: 26, left: 32 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  let minX = Math.min(...allPoints.map((p) => p.minutes));
  let maxX = Math.max(...allPoints.map((p) => p.minutes));
  if (minX === maxX) {
    minX -= 30;
    maxX += 30;
  }
  const maxY = Math.max(10, ...allPoints.map((p) => p.value)) * 1.15;

  const xPos = (m) => pad.left + ((m - minX) / (maxX - minX)) * plotW;
  const yPos = (v) => pad.top + plotH - (v / maxY) * plotH;

  ctx.strokeStyle = "rgba(245,245,245,0.12)";
  ctx.fillStyle = "rgba(245,245,245,0.5)";
  ctx.font = "11px -apple-system, sans-serif";
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const v = (maxY / gridLines) * i;
    const y = yPos(v);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(v)), pad.left - 6, y + 4);
  }

  ctx.textAlign = "center";
  [minX, (minX + maxX) / 2, maxX].forEach((m) => {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(Math.round(m % 60)).padStart(2, "0");
    ctx.fillText(`${hh}:${mm}`, xPos(m), h - 8);
  });

  function drawLine(series, color, dashed) {
    if (series.length === 0) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash(dashed ? [6, 5] : []);
    series.forEach((p, i) => {
      const x = xPos(p.minutes);
      const y = yPos(p.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = color;
    series.forEach((p) => {
      ctx.beginPath();
      ctx.arc(xPos(p.minutes), yPos(p.value), 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  drawLine(referenceSeries, "rgba(245,245,245,0.45)", true);
  drawLine(actualSeries, TYPE_COLOR[type], false);
}

function updateLegendLabel() {
  els.legendReferenceLabel.textContent =
    graphSource === "average" ? "Durchschnitt (Wochentag)" : `${graphSource} (Wochentag)`;
}

function renderSourceToggle() {
  els.graphSourceToggle.innerHTML = "";

  const makeBtn = (source, label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toggle-btn" + (source === graphSource ? " active" : "");
    btn.textContent = label;
    btn.dataset.graphSource = source;
    btn.addEventListener("click", async () => {
      if (source === graphSource) return;
      graphSource = source;
      renderSourceToggle();
      updateLegendLabel();
      await loadReference();
    });
    return btn;
  };

  els.graphSourceToggle.appendChild(makeBtn("average", "Durchschnitt"));
  graphYears.forEach((year) => els.graphSourceToggle.appendChild(makeBtn(year, year)));
}

async function loadReference() {
  els.graphStatus.textContent = "Lade Referenzdaten…";
  renderGraph();

  graphReferenceRows = await fetchReference(graphSource);
  els.graphStatus.textContent = graphReferenceRows && graphReferenceRows.length ? "" : "Keine Referenzdaten verfügbar";
  renderGraph();
}

async function openGraph() {
  els.graphOverlay.classList.remove("hidden");
  updateLegendLabel();
  renderGraph();

  graphYears = await fetchYearList();
  renderSourceToggle();

  await loadReference();
}

function closeGraph() {
  els.graphOverlay.classList.add("hidden");
}

els.graphOpen.addEventListener("click", openGraph);
els.graphClose.addEventListener("click", closeGraph);
els.graphOverlay.addEventListener("click", (e) => {
  if (e.target === els.graphOverlay) closeGraph();
});

document.querySelectorAll(".graph-toggle.type-toggle .toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    graphType = btn.dataset.graphType;
    document.querySelectorAll(".graph-toggle.type-toggle .toggle-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderGraph();
  });
});

window.addEventListener("resize", () => {
  if (!els.graphOverlay.classList.contains("hidden")) renderGraph();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkDayRollover();
});
window.addEventListener("focus", checkDayRollover);
setInterval(checkDayRollover, 60000);

// ---- Init -------------------------------------------------------------
renderSummary();
flushQueue();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
