import {
  listProperties,
  createProperty,
  updateProperty,
  deleteProperty,
} from "./api.js";

const tbody = () => document.querySelector("#propTable tbody");
const rowTmpl = () => document.querySelector("#rowTmpl");

let cache = [];
let editId = null;

/* ------------ helpers ------------ */
function createRow(item, idx) {
  const frag = rowTmpl().content.cloneNode(true);
  const tr = frag.querySelector("tr");
  tr.classList.add("propRow");
  tr.dataset.id = item.id;

  tr.querySelector(".rowIndex").textContent = idx + 1;
  tr.querySelector(".rowName").textContent = item.name ?? "";
  tr.querySelector(".rowPrice").textContent = item.price ?? "";
  tr.querySelector(".rowRooms").textContent = item.rooms ?? "";
  tr.querySelector(".rowSize").textContent = item.size ?? "";
  tr.querySelector(".rowCity").textContent = item.city ?? "";

  tr.querySelector(".editBtn").onclick = () => openEdit(item);

  // ---- OPTIMISTIC DELETE ----
  tr.querySelector(".delBtn").onclick = () => {
    if (!confirm("Delete?")) return;

    const parent = tbody();
    const idxBefore = Array.from(parent.children).indexOf(tr);

    // 1) Optimistically remove from UI + cache (no await)
    tr.remove();
    cache = cache.filter((x) => x.id !== item.id);
    reindexRows();

    // 2) Fire API in background; rollback on failure
    deleteProperty(item.id).catch((e) => {
      console.error(e);
      // rollback: reinsert row where it was
      const newRow = createRow(item, idxBefore);
      const ref = parent.children[idxBefore] || null;
      parent.insertBefore(newRow, ref);
      cache.push(item);
      cache.sort((a, b) => a.id - b.id); // or whatever order you use
      reindexRows();
      alert("Delete failed. Restored the row.");
    });
  };

  return tr;
}

function reindexRows() {
  const rows = tbody().querySelectorAll("tr.propRow .rowIndex");
  rows.forEach((cell, i) => (cell.textContent = i + 1));
}

/* ------------ render ------------ */
export async function renderTable(filter = "") {
  cache = await listProperties();
  const key = (filter || "").toLowerCase().trim();
  const rows = key
    ? cache.filter((x) => (x.name || "").toLowerCase().includes(key))
    : cache;

  const body = tbody();
  body.innerHTML = "";
  rows.forEach((item, idx) => body.appendChild(createRow(item, idx)));
}

/* ------------ dialog/edit (same as yours) ------------ */
const dlg = () => document.getElementById("editDlg");
const form = () => document.getElementById("propForm");
const dlgTitle = () => document.getElementById("dlgTitle");
const submitBtn = () => document.getElementById("submitBtn");

export function openCreate() {
  editId = null;
  dlgTitle().textContent = "Add data (Create)";
  submitBtn().textContent = "Add";
  form().reset();
  dlg().showModal();
}
export function openEdit(item) {
  editId = item.id;
  dlgTitle().textContent = "Update data (Update)";
  submitBtn().textContent = "Update";
  form().name.value = item.name ?? "";
  form().price.value = item.price ?? 0;
  form().rooms.value = item.rooms ?? 0;
  form().size.value = item.size ?? 0;
  form().city.value = item.city ?? "";
  form().desc.value = item.desc || "";
  dlg().showModal();
}

export function bindForm(onDone) {
  form().onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form());
    const payload = Object.fromEntries(fd.entries());
    payload.price = +payload.price || 0;
    payload.rooms = +payload.rooms || 0;
    payload.size = +payload.size || 0;

    if (editId == null) await createProperty(payload);
    else await updateProperty(editId, payload);

    dlg().close();
    await renderTable(document.querySelector("#filter")?.value || "");
    onDone && onDone();
  };
  document.getElementById("cancelBtn").onclick = () => dlg().close();
}
