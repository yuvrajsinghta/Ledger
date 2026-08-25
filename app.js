/* ============================================================
   HISAAB — Rozana Lena Dena Tracker
   Local-first storage + optional Google Sheets sync
   ============================================================ */

const STORAGE_KEY = "hisaab_entries_v1";

// Google Apps Script Web App URL — the sheet is connected via this
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxZokm1bHZqNO-qnS0cZGhO-ICsvc5_EQ09q21cGg9BgvG7LKRCEeWk-xeDWDoz6CoGQg/exec";

let entries = loadEntries();
let settings = { scriptUrl: SCRIPT_URL, autoSync: true };

let filters = { search: "", type: "all", mode: "all", month: "all" };
let editingId = null;

/* ---------------- Storage helpers ---------------- */
function loadEntries() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
}
function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/* ---------------- Utils ---------------- */
function uid() {
  return "e" + Date.now() + Math.random().toString(16).slice(2, 6);
}
function fmtMoney(n) {
  n = Number(n) || 0;
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function nowTimeStr() {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}
function monthKey(dateStr) {
  return dateStr.slice(0, 7); // YYYY-MM
}
function monthLabel(key) {
  const [y, m] = key.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return names[parseInt(m, 10) - 1] + " " + y;
}
function dateHeading(dateStr) {
  const today = todayStr();
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return "Today";
  if (dateStr === yest) return "Yesterday";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------------- Header date ---------------- */
document.getElementById("todayLabel").textContent = new Date().toLocaleDateString("en-IN", {
  weekday: "long", day: "numeric", month: "long"
});

/* ---------------- Month select ---------------- */
function populateMonthSelect() {
  const sel = document.getElementById("monthSelect");
  const keys = new Set(entries.map(e => monthKey(e.date)));
  keys.add(monthKey(todayStr()));
  const sorted = Array.from(keys).sort().reverse();
  const prevValue = sel.value || filters.month;
  sel.innerHTML = `<option value="all">All Months</option>` +
    sorted.map(k => `<option value="${k}">${monthLabel(k)}</option>`).join("");
  if ([...sel.options].some(o => o.value === prevValue)) sel.value = prevValue;
}

/* ---------------- Person suggestions ---------------- */
function populatePersonSuggestions() {
  const dl = document.getElementById("personSuggestions");
  const names = Array.from(new Set(entries.map(e => e.person))).sort();
  dl.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">`).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ---------------- Filtering ---------------- */
function getFiltered() {
  return entries.filter(e => {
    if (filters.type !== "all" && e.type !== filters.type) return false;
    if (filters.mode !== "all" && e.mode !== filters.mode) return false;
    if (filters.month !== "all" && monthKey(e.date) !== filters.month) return false;
    if (filters.search && !e.person.toLowerCase().includes(filters.search.toLowerCase()) &&
        !(e.note || "").toLowerCase().includes(filters.search.toLowerCase())) return false;
    return true;
  });
}

/* ---------------- Render ---------------- */
function render() {
  const filtered = getFiltered();

  // Summary
  let totalIn = 0, totalOut = 0, cash = 0, online = 0;
  filtered.forEach(e => {
    const amt = Number(e.amount) || 0;
    if (e.type === "in") totalIn += amt; else totalOut += amt;
    if (e.mode === "cash") cash += (e.type === "in" ? amt : -amt);
    else online += (e.type === "in" ? amt : -amt);
  });
  document.getElementById("balanceAmt").textContent = fmtMoney(totalIn - totalOut);
  document.getElementById("totalIn").textContent = fmtMoney(totalIn);
  document.getElementById("totalOut").textContent = fmtMoney(totalOut);
  document.getElementById("totalCash").textContent = fmtMoney(cash);
  document.getElementById("totalOnline").textContent = fmtMoney(online);

  const label = document.querySelector(".wallet-label");
  label.textContent = filters.month === "all" ? "Balance (all entries)" : `Balance (${monthLabel(filters.month)})`;

  // Group by date desc, sort within date by time desc
  const sorted = [...filtered].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (a.time || "") < (b.time || "") ? 1 : -1;
  });

  const groups = {};
  sorted.forEach(e => {
    if (!groups[e.date]) groups[e.date] = [];
    groups[e.date].push(e);
  });

  const container = document.getElementById("entries");
  const emptyState = document.getElementById("emptyState");

  if (sorted.length === 0) {
    container.innerHTML = "";
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    container.innerHTML = Object.keys(groups).map(date => {
      const dayEntries = groups[date];
      const dayNet = dayEntries.reduce((s, e) => s + (e.type === "in" ? Number(e.amount) : -Number(e.amount)), 0);
      return `
        <div class="date-group">
          <div class="date-heading">
            <span>${dateHeading(date)}</span>
            <span>${dayNet >= 0 ? "+" : ""}${fmtMoney(dayNet)}</span>
          </div>
          ${dayEntries.map(entryCardHtml).join("")}
        </div>
      `;
    }).join("");
  }

  populateMonthSelect();
  populatePersonSuggestions();
}

function entryCardHtml(e) {
  const icon = e.type === "in" ? "↓" : "↑";
  const modeIcon = e.mode === "cash" ? "💵" : "📲";
  const modeText = e.mode === "cash" ? "Cash" : "Online";
  return `
    <div class="entry-card ${e.type}" data-id="${e.id}">
      <div class="entry-icon">${icon}</div>
      <div class="entry-mid">
        <div class="entry-person">${escapeHtml(e.person)}</div>
        <div class="entry-meta">
          <span>${fmtTime(e.time)}</span>
          <span class="mode-tag">${modeIcon} ${modeText}</span>
          ${e.note ? `<span>· ${escapeHtml(e.note)}</span>` : ""}
        </div>
      </div>
      <div class="entry-amt">${e.type === "in" ? "+" : "−"}${fmtMoney(e.amount)}</div>
    </div>
  `;
}

/* ---------------- Filter UI wiring ---------------- */
document.getElementById("searchInput").addEventListener("input", (e) => {
  filters.search = e.target.value;
  render();
});
document.getElementById("monthSelect").addEventListener("change", (e) => {
  filters.month = e.target.value;
  render();
});
document.getElementById("typeChips").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  filters.type = btn.dataset.type;
  [...document.getElementById("typeChips").children].forEach(c => c.classList.remove("active"));
  btn.classList.add("active");
  render();
});
document.getElementById("modeChips").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  filters.mode = btn.dataset.mode;
  [...document.getElementById("modeChips").children].forEach(c => c.classList.remove("active"));
  btn.classList.add("active");
  render();
});

/* ---------------- Entry sheet (add/edit) ---------------- */
const entryOverlay = document.getElementById("entryOverlay");
const entryForm = document.getElementById("entryForm");
let currentType = "in";
let currentMode = "cash";

function openEntrySheet(entry) {
  editingId = entry ? entry.id : null;
  currentType = entry ? entry.type : "in";
  currentMode = entry ? entry.mode : "cash";

  document.getElementById("sheetTitle").textContent = entry ? "Edit Entry" : "New Entry";
  document.getElementById("fAmount").value = entry ? entry.amount : "";
  document.getElementById("fPerson").value = entry ? entry.person : "";
  document.getElementById("fDate").value = entry ? entry.date : todayStr();
  document.getElementById("fTime").value = entry ? entry.time : nowTimeStr();
  document.getElementById("fNote").value = entry ? (entry.note || "") : "";
  document.getElementById("deleteEntryBtn").hidden = !entry;

  updateTypeUI();
  updateModeUI();
  entryOverlay.classList.add("open");
}
function closeEntrySheet() {
  entryOverlay.classList.remove("open");
  editingId = null;
  entryForm.reset();
}
function updateTypeUI() {
  document.querySelectorAll(".toggle-btn").forEach(b => b.classList.toggle("active", b.dataset.type === currentType));
  document.getElementById("personLabel").textContent = currentType === "in" ? "Received From (Name)" : "Paid To (Name)";
}
function updateModeUI() {
  document.querySelectorAll(".mode-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === currentMode));
}
document.querySelectorAll(".toggle-btn").forEach(btn => {
  btn.addEventListener("click", () => { currentType = btn.dataset.type; updateTypeUI(); });
});
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => { currentMode = btn.dataset.mode; updateModeUI(); });
});

document.getElementById("addBtn").addEventListener("click", () => openEntrySheet(null));
document.getElementById("cancelBtn").addEventListener("click", closeEntrySheet);
entryOverlay.addEventListener("click", (e) => { if (e.target === entryOverlay) closeEntrySheet(); });

document.getElementById("entries").addEventListener("click", (e) => {
  const card = e.target.closest(".entry-card");
  if (!card) return;
  const entry = entries.find(x => x.id === card.dataset.id);
  if (entry) openEntrySheet(entry);
});

entryForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const amount = parseFloat(document.getElementById("fAmount").value);
  const person = document.getElementById("fPerson").value.trim();
  const date = document.getElementById("fDate").value;
  const time = document.getElementById("fTime").value;
  const note = document.getElementById("fNote").value.trim();

  if (!amount || amount <= 0 || !person || !date || !time) {
    toast("Please fill all required fields");
    return;
  }

  if (editingId) {
    const idx = entries.findIndex(x => x.id === editingId);
    if (idx > -1) {
      entries[idx] = { ...entries[idx], type: currentType, amount, person, date, time, mode: currentMode, note, updatedAt: new Date().toISOString(), synced: false };
      pushToSheet(entries[idx], "edit");
    }
    toast("Entry updated");
  } else {
    const entry = {
      id: uid(), type: currentType, amount, person, date, time, mode: currentMode, note,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), synced: false
    };
    entries.push(entry);
    pushToSheet(entry, "add");
    toast("Entry saved");
  }

  saveEntries();
  closeEntrySheet();
  render();
});

document.getElementById("deleteEntryBtn").addEventListener("click", () => {
  if (!editingId) return;
  const entry = entries.find(x => x.id === editingId);
  entries = entries.filter(x => x.id !== editingId);
  saveEntries();
  if (entry) pushToSheet(entry, "delete");
  toast("Entry deleted");
  closeEntrySheet();
  render();
});

function updateSyncStatus() {
  const el = document.getElementById("syncStatus");
  el.textContent = settings.scriptUrl ? "Connected to Google Sheet" : "Saved locally";
}

/* ---------------- Google Sheets sync ---------------- */
async function pushToSheet(entry, action) {
  if (!settings.scriptUrl || settings.autoSync === false) return;
  try {
    await fetch(settings.scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, entry })
    });
    const idx = entries.findIndex(x => x.id === entry.id);
    if (idx > -1) entries[idx].synced = true;
    saveEntries();
  } catch (err) {
    console.warn("Sheet push failed, will retry on next sync:", err);
  }
}

async function syncFromSheet() {
  if (!settings.scriptUrl) {
    toast("Sheet is not connected");
    return;
  }
  const syncBtn = document.getElementById("syncBtn");
  syncBtn.classList.add("spinning");
  try {
    // First push any unsynced local entries
    const unsynced = entries.filter(e => !e.synced);
    for (const e of unsynced) {
      await pushToSheet(e, "add");
    }
    // Then pull full list from sheet (sheet becomes source of truth)
    const res = await fetch(settings.scriptUrl, { method: "GET" });
    const data = await res.json();
    if (Array.isArray(data)) {
      entries = data.map(row => ({ ...row, synced: true }));
      saveEntries();
      render();
      toast("Synced with sheet ✓");
    }
  } catch (err) {
    console.warn("Sync failed:", err);
    toast("Sync failed — check your internet connection");
  } finally {
    syncBtn.classList.remove("spinning");
  }
}

document.getElementById("syncBtn").addEventListener("click", syncFromSheet);

/* ---------------- Init ---------------- */
updateSyncStatus();
render();
if (settings.scriptUrl && settings.autoSync !== false) {
  syncFromSheet();
}
