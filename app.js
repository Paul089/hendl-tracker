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

function renderSummary() {
  const totals = { hendl: 0, ente: 0 };
  for (const e of entries) totals[e.type] += e.quantity;
  els.totalHendl.textContent = totals.hendl;
  els.totalEnte.textContent = totals.ente;

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
          <span>${EMOJI[e.type]} ${e.quantity} ${e.type}${e.synced ? "" : " <span class=\"unsynced-dot\" title=\"Not yet synced\"></span>"}</span>
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
  showToast(`Logged ${quantity} ${entry.type} ✓`);

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
