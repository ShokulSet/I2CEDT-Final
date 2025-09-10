import {
  listProperties,
  createProperty,
  updateProperty,
  deleteProperty,
} from "./api.js";

const tbody = () => document.querySelector("#propTable tbody");
const rowTmpl = () => document.querySelector("#rowTmpl");

let editId = null;

export async function renderTable(filter = "") {
  const data = await listProperties();
  const filtered = data.filter((x) =>
    (x.name || "").toLowerCase().includes(filter),
  );
  const body = tbody();
  body.innerHTML = "";
  filtered.forEach((item, idx) => {
    const row = rowTmpl().content.cloneNode(true);
    row.querySelector(".rowIndex").textContent = idx + 1;
    row.querySelector(".rowName").textContent = item.name;
    row.querySelector(".rowPrice").textContent = item.price;
    row.querySelector(".rowRooms").textContent = item.rooms;
    row.querySelector(".rowSize").textContent = item.size;
    row.querySelector(".rowCity").textContent = item.city;
    row.querySelector(".editBtn").onclick = () => openEdit(item);
    row.querySelector(".delBtn").onclick = () => {
      if (confirm("Delete?")) {
        deleteProperty(item.id);
        renderTable(filter);
      }
    };
    body.appendChild(row);
  });
}

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
  form().name.value = item.name;
  form().price.value = item.price;
  form().rooms.value = item.rooms;
  form().size.value = item.size;
  form().city.value = item.city;
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
    onDone();
  };
  document.getElementById("cancelBtn").onclick = () => dlg().close();
}
