import { BACKEND_URL } from "./config.js";
import { renderTable, openCreate, bindForm } from "./table.js";

const promptBox = document.getElementById("prompt");
const expandBtn = document.getElementById("expandBtn");
const submitBtn = document.getElementById("submitBtn");
const resultPane = document.getElementById("resultPane");
const summaryBox = document.getElementById("summaryBox");
const selectedTableBody = document.querySelector("#selectedTable tbody");

// Tabs
const tabButtons = [...document.querySelectorAll(".tab")];
const tabSummary = document.getElementById("tab-summary");
const tabSelected = document.getElementById("tab-selected");

let filterText = "";
let is_expanded = false;

async function boot() {
  // Search on top-right of table
  document.getElementById("searchInput").addEventListener("input", () => {
    filterText = document
      .getElementById("searchInput")
      .value.trim()
      .toLowerCase();
    renderTable(filterText);
  });

  // Add + Modal
  document.getElementById("addBtn").addEventListener("click", openCreate);
  bindForm(() => renderTable(filterText));
  await renderTable();

  // Prompt expand only
  expandBtn.addEventListener("click", () => {
    is_expanded = !is_expanded;

    // swap class for transition instead of .hidden
    resultPane.classList.toggle("expanded", is_expanded);

    expandBtn.setAttribute("aria-expanded", String(is_expanded));
    expandBtn.classList.toggle("is-open", is_expanded);
  });

  // Analyze triggers backend then show tabs
  submitBtn.addEventListener("click", analyze);

  // Tabs behavior
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const t = btn.dataset.tab;
      tabSummary.classList.toggle("hidden", t !== "summary");
      tabSelected.classList.toggle("hidden", t !== "selected");
    });
  });
}
boot();

async function analyze() {
  const text = promptBox.value.trim();
  if (!text) return;

  let payload;
  try {
    const res = await fetch(`${BACKEND_URL}/qa/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text }),
    });
    payload = await res.json();
    if (!res.ok) throw new Error(payload?.error || res.statusText);
  } catch (e) {
    console.error(e);
    // graceful fallback if backend is not up
    payload = {
      sql: "-- backend unavailable --",
      rows: [],
      summary: "Backend unreachable. Check /qa/analyze.",
    };
  }

  // --- summary pane ---
  summaryBox.textContent = [
    payload.summary || "",
  ].join("\n");

  // --- selected table (DB → UI mapping) ---
  selectedTableBody.innerHTML = "";
  (payload.rows || []).forEach((r, i) => {
    const name = r.description ?? "";
    const price = r.price ?? "";
    const rooms = r.bedrooms ?? "";
    const size  = r.size ?? "";
    const city  = r.location ?? "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${name}</td>
      <td>${price}</td>
      <td>${rooms}</td>
      <td>${size}</td>
      <td>${city}</td>`;
    selectedTableBody.appendChild(tr);
  });

  // --- open result pane with animation (use class, not .hidden) ---
  resultPane.classList.add("expanded");
  expandBtn.hidden = false;                       // keep the button visible
  expandBtn.setAttribute("aria-expanded", "true");
  expandBtn.classList.add("is-open");             // if you rotate a chevron

  // --- switch to "selected table" tab ---
  document.querySelector(".tab.active")?.classList.remove("active");
  document.querySelector('.tab[data-tab="selected"]').classList.add("active");
  tabSummary.classList.add("hidden");
  tabSelected.classList.remove("hidden");
}
