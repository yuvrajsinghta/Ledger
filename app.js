/* ============================================================
   LEDGER — Daily Cash Flow + Dues Tracker
   Local-first storage + optional Google Sheets sync
   ============================================================ */

const STORAGE_KEY = "ledger_entries_v1";
const DUES_KEY = "ledger_dues_v1";

// Google Apps Script Web App URL — the sheet is connected via this
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxZokm1bHZqNO-qnS0cZGhO-ICsvc5_EQ09q21cGg9BgvG7LKRCEeWk-xeDWDoz6CoGQg/exec";

let entries = loadEntries();
let dues = loadDues();
let settings = { scriptUrl: SCRIPT_URL, autoSync: true };

let filters = { search: "", type: "all", mode: "all", period: "all", customFrom: null, customTo: null };
let duesFilters = { search: "", kind: "all", status: "pending" };
let editingId = null;
let editingDuesId = null;
let activeTab = "ledger";

/* ---------------- Storage helpers ---------------- */
function loadEntries() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch (e) { return []; }
}
function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}
function loadDues() {
  try { return JSON.parse(localStorage.getItem(DUES_KEY)) || []; }
  catch (e) { return []; }
}
function saveDues() {
  localStorage.setItem(DUES_KEY, JSON.stringify(dues));
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
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ---------------- Header date ---------------- */
document.getElementById("todayLabel").textContent = new Date().toLocaleDateString("en-IN", {
  weekday: "long", day: "numeric", month: "long"
});

/* ---------------- Date range helpers ---------------- */
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function startOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}
function getPeriodRange(period) {
  const today = todayStr();
  switch (period) {
    case "today": return { from: today, to: today };
    case "week": return { from: startOfWeek(today), to: today };
    case "7": return { from: addDays(today, -6), to: today };
    case "15": return { from: addDays(today, -14), to: today };
    case "month": return { from: today.slice(0, 8) + "01", to: today };
    case "30": return { from: addDays(today, -29), to: today };
    case "custom": return { from: filters.customFrom, to: filters.customTo };
    default: return null;
  }
}
function fmtShortDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
function periodLabel() {
  const p = filters.period;
  if (p === "all") return "Balance (all entries)";
  if (p === "today") return "Balance (Today)";
  if (p === "week") return "Balance (This Week)";
  if (p === "7") return "Balance (Last 7 Days)";
  if (p === "15") return "Balance (Last 15 Days)";
  if (p === "month") return "Balance (This Month)";
  if (p === "30") return "Balance (Last 30 Days)";
  if (p === "custom" && filters.customFrom && filters.customTo) {
    return `Balance (${fmtShortDate(filters.customFrom)} – ${fmtShortDate(filters.customTo)})`;
  }
  return "Balance (Custom Range)";
}

/* ---------------- Person suggestions ---------------- */
function populatePersonSuggestions() {
  const dl = document.getElementById("personSuggestions");
  const names = Array.from(new Set(entries.map(e => e.person))).sort();
  dl.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">`).join("");
}
function populateDuesPersonSuggestions() {
  const dl = document.getElementById("duesPersonSuggestions");
  const names = Array.from(new Set(dues.map(u => u.person))).sort();
  dl.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">`).join("");
}

/* ---------------- Ledger filtering ---------------- */
function getFiltered() {
  const range = getPeriodRange(filters.period);
  return entries.filter(e => {
    if (filters.type !== "all" && e.type !== filters.type) return false;
    if (filters.mode !== "all" && e.mode !== filters.mode) return false;
    if (range && range.from && range.to) {
      if (e.date < range.from || e.date > range.to) return false;
    }
    if (filters.search && !e.person.toLowerCase().includes(filters.search.toLowerCase()) &&
        !(e.note || "").toLowerCase().includes(filters.search.toLowerCase())) return false;
    return true;
  });
}

/* ---------------- Ledger render ---------------- */
function render() {
  const filtered = getFiltered();

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

  document.querySelector("#ledgerView .wallet-label").textContent = periodLabel();

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

  populatePersonSuggestions();
  renderChart();
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

/* ---------------- Trend chart ---------------- */
function getChartRange() {
  const range = getPeriodRange(filters.period);
  if (!range) return { from: addDays(todayStr(), -13), to: todayStr() };
  return range;
}
function renderChart() {
  const wrap = document.getElementById("chartWrap");
  const range = getChartRange();
  if (!range.from || !range.to) {
    wrap.innerHTML = `<div class="chart-empty">Select a valid date range</div>`;
    return;
  }

  let days = [];
  let d = range.from;
  while (d <= range.to && days.length < 400) { days.push(d); d = addDays(d, 1); }

  let bucketType = "day";
  let buckets = days;
  if (days.length > 30) {
    buckets = [];
    let bd = range.from;
    while (bd <= range.to) {
      const wEnd = addDays(bd, 6) > range.to ? range.to : addDays(bd, 6);
      buckets.push({ from: bd, to: wEnd });
      bd = addDays(bd, 7);
    }
    bucketType = "week";
  }

  const baseFiltered = entries.filter(e => {
    if (filters.type !== "all" && e.type !== filters.type) return false;
    if (filters.mode !== "all" && e.mode !== filters.mode) return false;
    if (filters.search && !e.person.toLowerCase().includes(filters.search.toLowerCase()) &&
        !(e.note || "").toLowerCase().includes(filters.search.toLowerCase())) return false;
    return true;
  });

  let dataPoints;
  if (bucketType === "day") {
    dataPoints = days.map(dt => {
      const dayEntries = baseFiltered.filter(e => e.date === dt);
      const inSum = dayEntries.filter(e => e.type === "in").reduce((s, e) => s + Number(e.amount), 0);
      const outSum = dayEntries.filter(e => e.type === "out").reduce((s, e) => s + Number(e.amount), 0);
      const dObj = new Date(dt + "T00:00:00");
      return { label: String(dObj.getDate()), title: fmtShortDate(dt), inSum, outSum };
    });
  } else {
    dataPoints = buckets.map(b => {
      const bEntries = baseFiltered.filter(e => e.date >= b.from && e.date <= b.to);
      const inSum = bEntries.filter(e => e.type === "in").reduce((s, e) => s + Number(e.amount), 0);
      const outSum = bEntries.filter(e => e.type === "out").reduce((s, e) => s + Number(e.amount), 0);
      return { label: fmtShortDate(b.from).split(" ")[0], title: `${fmtShortDate(b.from)} – ${fmtShortDate(b.to)}`, inSum, outSum };
    });
  }

  if (dataPoints.every(p => p.inSum === 0 && p.outSum === 0)) {
    wrap.innerHTML = `<div class="chart-empty">No data in this range yet</div>`;
    return;
  }

  const maxVal = Math.max(1, ...dataPoints.map(p => Math.max(p.inSum, p.outSum)));

  wrap.innerHTML = `<div class="chart-bars">` + dataPoints.map(p => {
    const inH = Math.max(2, Math.round((p.inSum / maxVal) * 82));
    const outH = Math.max(2, Math.round((p.outSum / maxVal) * 82));
    return `
      <div class="chart-col" title="${p.title}: In ${fmtMoney(p.inSum)}, Out ${fmtMoney(p.outSum)}">
        <div class="chart-bar-pair">
          <div class="chart-bar in" style="height:${p.inSum > 0 ? inH : 0}px"></div>
          <div class="chart-bar out" style="height:${p.outSum > 0 ? outH : 0}px"></div>
        </div>
        <span class="chart-day-label">${p.label}</span>
      </div>`;
  }).join("") + `</div>`;
}

/* ---------------- Ledger filter UI wiring ---------------- */
document.getElementById("searchInput").addEventListener("input", (e) => {
  filters.search = e.target.value;
  render();
});
document.getElementById("periodRow").addEventListener("click", (e) => {
  const btn = e.target.closest(".period-chip");
  if (!btn) return;
  const period = btn.dataset.period;

  [...document.getElementById("periodRow").children].forEach(c => c.classList.remove("active"));
  btn.classList.add("active");

  const customRow = document.getElementById("customRangeRow");
  if (period === "custom") {
    customRow.hidden = false;
    if (!document.getElementById("customFrom").value) document.getElementById("customFrom").value = addDays(todayStr(), -6);
    if (!document.getElementById("customTo").value) document.getElementById("customTo").value = todayStr();
    return;
  }
  customRow.hidden = true;
  filters.period = period;
  render();
});
document.getElementById("applyCustomRange").addEventListener("click", () => {
  const from = document.getElementById("customFrom").value;
  const to = document.getElementById("customTo").value;
  if (!from || !to) { toast("Please select both dates"); return; }
  if (from > to) { toast("From date should be before To date"); return; }
  filters.period = "custom";
  filters.customFrom = from;
  filters.customTo = to;
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

/* ---------------- Ledger entry sheet (add/edit) ---------------- */
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
  document.querySelectorAll("#entrySheet .toggle-btn").forEach(b => b.classList.toggle("active", b.dataset.type === currentType));
  document.getElementById("personLabel").textContent = currentType === "in" ? "Received From (Name)" : "Paid To (Name)";
}
function updateModeUI() {
  document.querySelectorAll(".mode-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === currentMode));
}
document.querySelectorAll("#entrySheet .toggle-btn").forEach(btn => {
  btn.addEventListener("click", () => { currentType = btn.dataset.type; updateTypeUI(); });
});
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => { currentMode = btn.dataset.mode; updateModeUI(); });
});

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

/* ================================================================
   DUES (PENDING) TRACKER
   ================================================================ */
function getFilteredDues() {
  return dues.filter(u => {
    if (duesFilters.status === "pending" && u.settled) return false;
    if (duesFilters.status === "settled" && !u.settled) return false;
    if (duesFilters.kind !== "all" && u.kind !== duesFilters.kind) return false;
    if (duesFilters.search && !u.person.toLowerCase().includes(duesFilters.search.toLowerCase())) return false;
    return true;
  });
}

function renderDues() {
  let totalReceivable = 0, totalPayable = 0;
  dues.forEach(u => {
    if (!u.settled) {
      if (u.kind === "receivable") totalReceivable += Number(u.amount);
      else totalPayable += Number(u.amount);
    }
  });
  document.getElementById("totalReceivable").textContent = fmtMoney(totalReceivable);
  document.getElementById("totalPayable").textContent = fmtMoney(totalPayable);

  const list = getFilteredDues().sort((a, b) => (a.date < b.date ? 1 : -1));
  const container = document.getElementById("duesEntries");
  const emptyState = document.getElementById("duesEmptyState");

  if (list.length === 0) {
    container.innerHTML = "";
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    container.innerHTML = list.map(duesCardHtml).join("");
  }
  populateDuesPersonSuggestions();
}

function duesCardHtml(u) {
  const icon = u.kind === "receivable" ? "↓" : "↑";
  const cardClass = u.kind === "receivable" ? "in" : "out";
  const badge = u.settled
    ? `<span class="dues-badge settled">Settled ${fmtShortDate(u.settledDate)}</span>`
    : `<span class="dues-badge pending">Pending</span>`;
  return `
    <div class="entry-card ${cardClass} ${u.settled ? "settled" : ""}" data-id="${u.id}">
      <div class="entry-icon">${icon}</div>
      <div class="entry-mid">
        <div class="entry-person">${escapeHtml(u.person)}</div>
        <div class="entry-meta">
          <span>${dateHeading(u.date)}</span>
          ${badge}
          ${u.note ? `<span>· ${escapeHtml(u.note)}</span>` : ""}
        </div>
      </div>
      <div class="entry-amt">${fmtMoney(u.amount)}</div>
    </div>
  `;
}

document.getElementById("duesSearchInput").addEventListener("input", (e) => {
  duesFilters.search = e.target.value;
  renderDues();
});
document.getElementById("duesKindChips").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  duesFilters.kind = btn.dataset.kind;
  [...document.getElementById("duesKindChips").children].forEach(c => c.classList.remove("active"));
  btn.classList.add("active");
  renderDues();
});
document.getElementById("duesStatusChips").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  duesFilters.status = btn.dataset.status;
  [...document.getElementById("duesStatusChips").children].forEach(c => c.classList.remove("active"));
  btn.classList.add("active");
  renderDues();
});

/* ---------------- Dues sheet (add/edit) ---------------- */
const duesOverlay = document.getElementById("duesOverlay");
const duesForm = document.getElementById("duesForm");
let currentDuesKind = "receivable";

function openDuesSheet(u) {
  editingDuesId = u ? u.id : null;
  currentDuesKind = u ? u.kind : "receivable";

  document.getElementById("duesSheetTitle").textContent = u ? "Edit Dues" : "New Dues";
  document.getElementById("uAmount").value = u ? u.amount : "";
  document.getElementById("uPerson").value = u ? u.person : "";
  document.getElementById("uDate").value = u ? u.date : todayStr();
  document.getElementById("uNote").value = u ? (u.note || "") : "";
  document.getElementById("deleteDuesBtn").hidden = !u;

  const settledBanner = document.getElementById("settledBanner");
  const markBtn = document.getElementById("markSettledBtn");
  if (u && u.settled) {
    settledBanner.hidden = false;
    document.getElementById("settledOnDate").textContent = fmtShortDate(u.settledDate);
    markBtn.hidden = true;
  } else {
    settledBanner.hidden = true;
    markBtn.hidden = !u;
  }

  updateDuesKindUI();
  duesOverlay.classList.add("open");
}
function closeDuesSheet() {
  duesOverlay.classList.remove("open");
  editingDuesId = null;
  duesForm.reset();
}
function updateDuesKindUI() {
  document.querySelectorAll("#duesSheet .toggle-btn").forEach(b => b.classList.toggle("active", b.dataset.kind === currentDuesKind));
  document.getElementById("duesPersonLabel").textContent = currentDuesKind === "receivable" ? "Who owes you? (Name)" : "Who do you owe? (Name)";
}
document.querySelectorAll("#duesSheet .toggle-btn").forEach(btn => {
  btn.addEventListener("click", () => { currentDuesKind = btn.dataset.kind; updateDuesKindUI(); });
});

document.getElementById("duesCancelBtn").addEventListener("click", closeDuesSheet);
duesOverlay.addEventListener("click", (e) => { if (e.target === duesOverlay) closeDuesSheet(); });

document.getElementById("duesEntries").addEventListener("click", (e) => {
  const card = e.target.closest(".entry-card");
  if (!card) return;
  const u = dues.find(x => x.id === card.dataset.id);
  if (u) openDuesSheet(u);
});

duesForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const amount = parseFloat(document.getElementById("uAmount").value);
  const person = document.getElementById("uPerson").value.trim();
  const date = document.getElementById("uDate").value;
  const note = document.getElementById("uNote").value.trim();

  if (!amount || amount <= 0 || !person || !date) {
    toast("Please fill all required fields");
    return;
  }

  if (editingDuesId) {
    const idx = dues.findIndex(x => x.id === editingDuesId);
    if (idx > -1) {
      dues[idx] = { ...dues[idx], kind: currentDuesKind, amount, person, date, note, updatedAt: new Date().toISOString(), synced: false };
      pushDuesToSheet(dues[idx], "edit");
    }
    toast("Dues updated");
  } else {
    const u = {
      id: uid(), kind: currentDuesKind, amount, person, date, note,
      settled: false, settledDate: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), synced: false
    };
    dues.push(u);
    pushDuesToSheet(u, "add");
    toast("Dues saved");
  }

  saveDues();
  closeDuesSheet();
  renderDues();
});

document.getElementById("deleteDuesBtn").addEventListener("click", () => {
  if (!editingDuesId) return;
  const u = dues.find(x => x.id === editingDuesId);
  dues = dues.filter(x => x.id !== editingDuesId);
  saveDues();
  if (u) pushDuesToSheet(u, "delete");
  toast("Dues deleted");
  closeDuesSheet();
  renderDues();
});

document.getElementById("markSettledBtn").addEventListener("click", () => {
  if (!editingDuesId) return;
  const idx = dues.findIndex(x => x.id === editingDuesId);
  if (idx === -1) return;
  const u = dues[idx];
  u.settled = true;
  u.settledDate = todayStr();
  u.updatedAt = new Date().toISOString();
  u.synced = false;
  saveDues();
  pushDuesToSheet(u, "edit");

  // Automatically log the matching cash movement in the Ledger
  const ledgerEntry = {
    id: uid(), type: u.kind === "receivable" ? "in" : "out", amount: u.amount, person: u.person,
    date: todayStr(), time: nowTimeStr(), mode: "cash",
    note: "Dues settled" + (u.note ? (" — " + u.note) : ""),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), synced: false
  };
  entries.push(ledgerEntry);
  saveEntries();
  pushToSheet(ledgerEntry, "add");

  toast("Marked as settled — added to Ledger");
  closeDuesSheet();
  renderDues();
  render();
});

/* ---------------- Tab switching ---------------- */
function switchTab(tab) {
  activeTab = tab;
  document.getElementById("ledgerView").hidden = tab !== "ledger";
  document.getElementById("duesView").hidden = tab !== "dues";
  document.getElementById("tabLedger").classList.toggle("active", tab === "ledger");
  document.getElementById("tabDues").classList.toggle("active", tab === "dues");
  if (tab === "dues") renderDues();
}
document.getElementById("tabLedger").addEventListener("click", () => switchTab("ledger"));
document.getElementById("tabDues").addEventListener("click", () => switchTab("dues"));
document.getElementById("addBtn").addEventListener("click", () => {
  if (activeTab === "ledger") openEntrySheet(null);
  else openDuesSheet(null);
});

/* ---------------- Export (Excel / PDF) ---------------- */
const exportOverlay = document.getElementById("exportOverlay");
document.getElementById("exportBtn").addEventListener("click", () => exportOverlay.classList.add("open"));
document.getElementById("exportCancelBtn").addEventListener("click", () => exportOverlay.classList.remove("open"));
exportOverlay.addEventListener("click", (e) => { if (e.target === exportOverlay) exportOverlay.classList.remove("open"); });

document.getElementById("exportExcelBtn").addEventListener("click", () => {
  exportExcel();
  exportOverlay.classList.remove("open");
});
document.getElementById("exportPdfBtn").addEventListener("click", () => {
  exportPdf();
  exportOverlay.classList.remove("open");
});

function exportExcel() {
  const rows = activeTab === "ledger" ? getFiltered() : getFilteredDues();
  if (rows.length === 0) { toast("No data to export"); return; }

  let data;
  if (activeTab === "ledger") {
    data = [...rows].sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : (a.time < b.time ? -1 : 1))))
      .map(e => ({
        Date: e.date, Time: e.time, Type: e.type === "in" ? "Money In" : "Money Out",
        Amount: Number(e.amount), Mode: e.mode === "cash" ? "Cash" : "Online",
        Person: e.person, Note: e.note || ""
      }));
  } else {
    data = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1))
      .map(u => ({
        Date: u.date, Type: u.kind === "receivable" ? "To Receive" : "To Pay",
        Amount: Number(u.amount), Person: u.person,
        Status: u.settled ? `Settled on ${u.settledDate}` : "Pending", Note: u.note || ""
      }));
  }

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, activeTab === "ledger" ? "Ledger" : "Dues");
  const filename = `${activeTab === "ledger" ? "Ledger" : "Dues"}_${todayStr()}.xlsx`;
  XLSX.writeFile(wb, filename);
  toast("Excel file downloaded");
}

function exportPdf() {
  const rows = activeTab === "ledger" ? getFiltered() : getFilteredDues();
  if (rows.length === 0) { toast("No data to export"); return; }

  const printArea = document.getElementById("printArea");
  let html = `<h1>${activeTab === "ledger" ? "Ledger Statement" : "Dues Statement"}</h1>
    <div class="print-sub">Generated on ${new Date().toLocaleString("en-IN")}</div><table><thead><tr>`;

  if (activeTab === "ledger") {
    html += `<th>Date</th><th>Time</th><th>Type</th><th>Amount</th><th>Mode</th><th>Person</th><th>Note</th></tr></thead><tbody>`;
    const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : (a.date > b.date ? -1 : (a.time < b.time ? 1 : -1))));
    let totalIn = 0, totalOut = 0;
    sorted.forEach(e => {
      if (e.type === "in") totalIn += Number(e.amount); else totalOut += Number(e.amount);
      html += `<tr><td>${e.date}</td><td>${fmtTime(e.time)}</td>
        <td class="${e.type === "in" ? "print-in" : "print-out"}">${e.type === "in" ? "In" : "Out"}</td>
        <td>${fmtMoney(e.amount)}</td><td>${e.mode === "cash" ? "Cash" : "Online"}</td>
        <td>${escapeHtml(e.person)}</td><td>${escapeHtml(e.note || "")}</td></tr>`;
    });
    html += `</tbody></table><div class="print-summary">Total In: ${fmtMoney(totalIn)} &nbsp;|&nbsp; Total Out: ${fmtMoney(totalOut)} &nbsp;|&nbsp; Balance: ${fmtMoney(totalIn - totalOut)}</div>`;
  } else {
    html += `<th>Date</th><th>Type</th><th>Amount</th><th>Person</th><th>Status</th><th>Note</th></tr></thead><tbody>`;
    const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : -1));
    let totalRec = 0, totalPay = 0;
    sorted.forEach(u => {
      if (!u.settled) { if (u.kind === "receivable") totalRec += Number(u.amount); else totalPay += Number(u.amount); }
      html += `<tr><td>${u.date}</td>
        <td class="${u.kind === "receivable" ? "print-in" : "print-out"}">${u.kind === "receivable" ? "To Receive" : "To Pay"}</td>
        <td>${fmtMoney(u.amount)}</td><td>${escapeHtml(u.person)}</td>
        <td>${u.settled ? `Settled ${u.settledDate}` : "Pending"}</td><td>${escapeHtml(u.note || "")}</td></tr>`;
    });
    html += `</tbody></table><div class="print-summary">Pending — To Receive: ${fmtMoney(totalRec)} &nbsp;|&nbsp; To Pay: ${fmtMoney(totalPay)}</div>`;
  }

  printArea.innerHTML = html;
  window.print();
}

/* ================================================================
   PEOPLE / TAGS
   ================================================================ */
const TAGS_KEY = "ledger_tags_v1";
let manualTags = loadTags();
let currentPersonName = null;

function loadTags() {
  try { return JSON.parse(localStorage.getItem(TAGS_KEY)) || []; }
  catch (e) { return []; }
}
function saveTags() {
  localStorage.setItem(TAGS_KEY, JSON.stringify(manualTags));
}

function getAllTagsData() {
  const map = {};
  function consider(name, date) {
    if (!name) return;
    const key = name.trim().toLowerCase();
    if (!key) return;
    if (!map[key]) map[key] = { name: name.trim(), lastDate: date || "" };
    else if (date && date > map[key].lastDate) map[key].lastDate = date;
  }
  entries.forEach(e => consider(e.person, e.date));
  dues.forEach(u => consider(u.person, u.date));
  manualTags.forEach(n => consider(n, ""));
  return Object.values(map).sort((a, b) => (b.lastDate || "").localeCompare(a.lastDate || ""));
}

function getPersonSummary(name) {
  const key = name.trim().toLowerCase();
  const personEntries = entries.filter(e => e.person.trim().toLowerCase() === key);
  const personDues = dues.filter(u => u.person.trim().toLowerCase() === key);
  const given = personEntries.filter(e => e.type === "out").reduce((s, e) => s + Number(e.amount), 0);
  const received = personEntries.filter(e => e.type === "in").reduce((s, e) => s + Number(e.amount), 0);
  const payable = personDues.filter(u => u.kind === "payable" && !u.settled).reduce((s, u) => s + Number(u.amount), 0);
  const receivable = personDues.filter(u => u.kind === "receivable" && !u.settled).reduce((s, u) => s + Number(u.amount), 0);
  return {
    given, received, payable, receivable, net: receivable - payable,
    txnCount: personEntries.length + personDues.length,
    entries: personEntries, dues: personDues
  };
}

const peopleOverlay = document.getElementById("peopleOverlay");

function renderPeopleList() {
  const search = (document.getElementById("peopleSearchInput").value || "").toLowerCase();
  const tags = getAllTagsData().filter(t => t.name.toLowerCase().includes(search));
  const container = document.getElementById("peopleList");
  const emptyState = document.getElementById("peopleEmptyState");

  if (tags.length === 0) {
    container.innerHTML = "";
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;
  container.innerHTML = tags.map(t => {
    const s = getPersonSummary(t.name);
    const netClass = s.net > 0 ? "pos" : s.net < 0 ? "neg" : "zero";
    const netLabel = s.net === 0 ? "No dues" : (s.net > 0 ? `+${fmtMoney(s.net)}` : `−${fmtMoney(Math.abs(s.net))}`);
    const initial = t.name.charAt(0).toUpperCase();
    return `
      <div class="person-row" data-name="${escapeHtml(t.name)}">
        <div class="person-avatar">${initial}</div>
        <div class="person-mid">
          <div class="person-name">${escapeHtml(t.name)}</div>
          <div class="person-sub">${s.txnCount} ${s.txnCount === 1 ? "entry" : "entries"}</div>
        </div>
        <div class="person-net-tag ${netClass}">${netLabel}</div>
      </div>
    `;
  }).join("");
}

function personCardHtml(item) {
  if (item._kind === "ledger") {
    const e = item;
    const icon = e.type === "in" ? "↓" : "↑";
    const modeIcon = e.mode === "cash" ? "💵" : "📲";
    return `
      <div class="entry-card ${e.type}" data-kind="ledger" data-id="${e.id}">
        <div class="entry-icon">${icon}</div>
        <div class="entry-mid">
          <div class="entry-person">${dateHeading(e.date)} · ${fmtTime(e.time)}</div>
          <div class="entry-meta">
            <span class="mode-tag">${modeIcon} ${e.mode === "cash" ? "Cash" : "Online"}</span>
            ${e.note ? `<span>· ${escapeHtml(e.note)}</span>` : ""}
          </div>
        </div>
        <div class="entry-amt">${e.type === "in" ? "+" : "−"}${fmtMoney(e.amount)}</div>
      </div>`;
  }
  const u = item;
  const icon = u.kind === "receivable" ? "↓" : "↑";
  const cardClass = u.kind === "receivable" ? "in" : "out";
  const badge = u.settled
    ? `<span class="dues-badge settled">Settled ${fmtShortDate(u.settledDate)}</span>`
    : `<span class="dues-badge pending">Pending</span>`;
  return `
    <div class="entry-card ${cardClass} ${u.settled ? "settled" : ""}" data-kind="dues" data-id="${u.id}">
      <div class="entry-icon">${icon}</div>
      <div class="entry-mid">
        <div class="entry-person">${dateHeading(u.date)}</div>
        <div class="entry-meta">${badge}${u.note ? `<span>· ${escapeHtml(u.note)}</span>` : ""}</div>
      </div>
      <div class="entry-amt">${fmtMoney(u.amount)}</div>
    </div>`;
}

function openPersonDetail(name) {
  currentPersonName = name;
  document.getElementById("peopleListScreen").hidden = true;
  document.getElementById("personDetailScreen").hidden = false;
  document.getElementById("personDetailName").textContent = name;

  const s = getPersonSummary(name);
  document.getElementById("personGiven").textContent = fmtMoney(s.given);
  document.getElementById("personReceived").textContent = fmtMoney(s.received);
  document.getElementById("personPayable").textContent = fmtMoney(s.payable);
  document.getElementById("personReceivable").textContent = fmtMoney(s.receivable);

  const netLine = document.getElementById("personNetLine");
  if (s.net > 0) netLine.textContent = `You need to receive ${fmtMoney(s.net)} from ${name}`;
  else if (s.net < 0) netLine.textContent = `You need to pay ${fmtMoney(Math.abs(s.net))} to ${name}`;
  else netLine.textContent = `No pending dues with ${name}`;

  document.getElementById("deleteTagBtn").hidden = s.txnCount > 0;

  const combined = [
    ...s.entries.map(e => ({ ...e, _kind: "ledger" })),
    ...s.dues.map(u => ({ ...u, _kind: "dues" }))
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  const historyEl = document.getElementById("personHistory");
  historyEl.innerHTML = combined.length === 0
    ? `<div class="empty-state"><p>No activity yet</p><span>Entries tagged with this name will show up here.</span></div>`
    : combined.map(personCardHtml).join("");
}

document.getElementById("peopleBtn").addEventListener("click", () => {
  document.getElementById("peopleListScreen").hidden = false;
  document.getElementById("personDetailScreen").hidden = true;
  document.getElementById("peopleSearchInput").value = "";
  renderPeopleList();
  peopleOverlay.classList.add("open");
});
document.getElementById("peopleCloseBtn").addEventListener("click", () => peopleOverlay.classList.remove("open"));
peopleOverlay.addEventListener("click", (e) => { if (e.target === peopleOverlay) peopleOverlay.classList.remove("open"); });

document.getElementById("peopleSearchInput").addEventListener("input", renderPeopleList);
document.getElementById("peopleList").addEventListener("click", (e) => {
  const row = e.target.closest(".person-row");
  if (!row) return;
  openPersonDetail(row.dataset.name);
});

document.getElementById("addTagBtn").addEventListener("click", () => {
  const row = document.getElementById("addTagRow");
  row.hidden = !row.hidden;
  if (!row.hidden) document.getElementById("newTagInput").focus();
});
document.getElementById("confirmTagBtn").addEventListener("click", () => {
  const val = document.getElementById("newTagInput").value.trim();
  if (!val) { toast("Enter a name"); return; }
  const exists = getAllTagsData().some(t => t.name.toLowerCase() === val.toLowerCase());
  if (!exists) { manualTags.push(val); saveTags(); }
  document.getElementById("newTagInput").value = "";
  document.getElementById("addTagRow").hidden = true;
  renderPeopleList();
  openPersonDetail(val);
});

document.getElementById("personBackBtn").addEventListener("click", () => {
  document.getElementById("personDetailScreen").hidden = true;
  document.getElementById("peopleListScreen").hidden = false;
  renderPeopleList();
});

document.getElementById("deleteTagBtn").addEventListener("click", () => {
  if (!currentPersonName) return;
  manualTags = manualTags.filter(n => n.toLowerCase() !== currentPersonName.toLowerCase());
  saveTags();
  toast("Tag deleted");
  document.getElementById("personDetailScreen").hidden = true;
  document.getElementById("peopleListScreen").hidden = false;
  renderPeopleList();
});

document.getElementById("personHistory").addEventListener("click", (e) => {
  const card = e.target.closest(".entry-card");
  if (!card) return;
  const kind = card.dataset.kind;
  const id = card.dataset.id;
  peopleOverlay.classList.remove("open");
  if (kind === "ledger") {
    const entry = entries.find(x => x.id === id);
    if (entry) { switchTab("ledger"); openEntrySheet(entry); }
  } else {
    const u = dues.find(x => x.id === id);
    if (u) { switchTab("dues"); openDuesSheet(u); }
  }
});

/* ---------------- Person-scoped export ---------------- */
document.getElementById("personExportExcelBtn").addEventListener("click", () => exportPersonExcel(currentPersonName));
document.getElementById("personExportPdfBtn").addEventListener("click", () => exportPersonPdf(currentPersonName));

function exportPersonExcel(name) {
  const s = getPersonSummary(name);
  if (s.txnCount === 0) { toast("No data to export"); return; }

  const wb = XLSX.utils.book_new();
  const ledgerData = [...s.entries].sort((a, b) => (a.date < b.date ? -1 : 1)).map(e => ({
    Date: e.date, Time: e.time, Type: e.type === "in" ? "Money In" : "Money Out",
    Amount: Number(e.amount), Mode: e.mode === "cash" ? "Cash" : "Online", Note: e.note || ""
  }));
  const duesData = [...s.dues].sort((a, b) => (a.date < b.date ? -1 : 1)).map(u => ({
    Date: u.date, Type: u.kind === "receivable" ? "To Receive" : "To Pay",
    Amount: Number(u.amount), Status: u.settled ? `Settled on ${u.settledDate}` : "Pending", Note: u.note || ""
  }));

  if (ledgerData.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ledgerData), "Ledger");
  if (duesData.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(duesData), "Dues");

  XLSX.writeFile(wb, `${name.replace(/\s+/g, "_")}_Statement_${todayStr()}.xlsx`);
  toast("Excel file downloaded");
}

function exportPersonPdf(name) {
  const s = getPersonSummary(name);
  if (s.txnCount === 0) { toast("No data to export"); return; }

  const printArea = document.getElementById("printArea");
  let html = `<h1>${escapeHtml(name)} — Statement</h1>
    <div class="print-sub">Generated on ${new Date().toLocaleString("en-IN")}</div>
    <div class="print-summary">Given: ${fmtMoney(s.given)} &nbsp;|&nbsp; Received: ${fmtMoney(s.received)} &nbsp;|&nbsp; To Receive: ${fmtMoney(s.receivable)} &nbsp;|&nbsp; To Pay: ${fmtMoney(s.payable)}</div>`;

  if (s.entries.length) {
    html += `<h2 style="margin-top:16px;font-size:15px;">Ledger</h2><table><thead><tr><th>Date</th><th>Time</th><th>Type</th><th>Amount</th><th>Mode</th><th>Note</th></tr></thead><tbody>`;
    [...s.entries].sort((a, b) => (a.date < b.date ? 1 : -1)).forEach(e => {
      html += `<tr><td>${e.date}</td><td>${fmtTime(e.time)}</td>
        <td class="${e.type === "in" ? "print-in" : "print-out"}">${e.type === "in" ? "In" : "Out"}</td>
        <td>${fmtMoney(e.amount)}</td><td>${e.mode === "cash" ? "Cash" : "Online"}</td><td>${escapeHtml(e.note || "")}</td></tr>`;
    });
    html += `</tbody></table>`;
  }
  if (s.dues.length) {
    html += `<h2 style="margin-top:16px;font-size:15px;">Dues</h2><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Status</th><th>Note</th></tr></thead><tbody>`;
    [...s.dues].sort((a, b) => (a.date < b.date ? 1 : -1)).forEach(u => {
      html += `<tr><td>${u.date}</td>
        <td class="${u.kind === "receivable" ? "print-in" : "print-out"}">${u.kind === "receivable" ? "To Receive" : "To Pay"}</td>
        <td>${fmtMoney(u.amount)}</td><td>${u.settled ? `Settled ${u.settledDate}` : "Pending"}</td><td>${escapeHtml(u.note || "")}</td></tr>`;
    });
    html += `</tbody></table>`;
  }

  printArea.innerHTML = html;
  window.print();
}

/* ---------------- Google Sheets sync ---------------- */
function updateSyncStatus() {
  const el = document.getElementById("syncStatus");
  el.textContent = settings.scriptUrl ? "Connected to Google Sheet" : "Saved locally";
}

async function pushToSheet(entry, action) {
  if (!settings.scriptUrl || settings.autoSync === false) return;
  try {
    await fetch(settings.scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, entry, sheetType: "ledger" })
    });
    const idx = entries.findIndex(x => x.id === entry.id);
    if (idx > -1) entries[idx].synced = true;
    saveEntries();
  } catch (err) {
    console.warn("Sheet push failed, will retry on next sync:", err);
  }
}
async function pushDuesToSheet(u, action) {
  if (!settings.scriptUrl || settings.autoSync === false) return;
  try {
    await fetch(settings.scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, entry: u, sheetType: "dues" })
    });
    const idx = dues.findIndex(x => x.id === u.id);
    if (idx > -1) dues[idx].synced = true;
    saveDues();
  } catch (err) {
    console.warn("Dues push failed, will retry on next sync:", err);
  }
}

async function syncLedgerFromSheet() {
  const unsynced = entries.filter(e => !e.synced);
  for (const e of unsynced) { await pushToSheet(e, "add"); }
  const res = await fetch(settings.scriptUrl, { method: "GET" });
  const data = await res.json();
  if (Array.isArray(data)) {
    entries = data.map(row => ({ ...row, synced: true }));
    saveEntries();
    render();
  }
}
async function syncDuesFromSheet() {
  const unsynced = dues.filter(u => !u.synced);
  for (const u of unsynced) { await pushDuesToSheet(u, "add"); }
  const res = await fetch(settings.scriptUrl + "?type=dues", { method: "GET" });
  const data = await res.json();
  if (Array.isArray(data)) {
    dues = data.map(row => ({ ...row, synced: true }));
    saveDues();
    if (activeTab === "dues") renderDues();
  }
}

async function syncAll() {
  if (!settings.scriptUrl) {
    toast("Sheet is not connected");
    return;
  }
  const syncBtn = document.getElementById("syncBtn");
  syncBtn.classList.add("spinning");
  try {
    await syncLedgerFromSheet();
    await syncDuesFromSheet();
    toast("Synced with sheet ✓");
  } catch (err) {
    console.warn("Sync failed:", err);
    toast("Sync failed — check your internet connection");
  } finally {
    syncBtn.classList.remove("spinning");
  }
}

document.getElementById("syncBtn").addEventListener("click", syncAll);

/* ---------------- Init ---------------- */
updateSyncStatus();
render();
if (settings.scriptUrl && settings.autoSync !== false) {
  syncAll();
}
