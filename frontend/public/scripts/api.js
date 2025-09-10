const lsKey = "re_props_v1";
const number = (v) => (isNaN(+v) ? 0 : +v);

function seed() {
  const d = [
    {
      id: 1,
      name: "U House",
      price: 69420,
      rooms: 4,
      size: 69,
      city: "New Cairo",
    },
    {
      id: 2,
      name: "Lotus Condo",
      price: 2500000,
      rooms: 2,
      size: 55,
      city: "New Cairo",
    },
    {
      id: 3,
      name: "Nile View",
      price: 4200000,
      rooms: 3,
      size: 92,
      city: "Zamalek",
    },
    {
      id: 4,
      name: "Garden Flat",
      price: 1800000,
      rooms: 1,
      size: 40,
      city: "Maadi",
    },
  ];
  localStorage.setItem(lsKey, JSON.stringify(d));
  return d;
}
function getAll() {
  return JSON.parse(localStorage.getItem(lsKey) || "null") || seed();
}
function setAll(a) {
  localStorage.setItem(lsKey, JSON.stringify(a));
}

export async function listProperties() {
  return getAll();
}
export async function createProperty(payload) {
  const all = getAll();
  const id = Math.max(0, ...all.map((x) => x.id)) + 1;
  all.push({
    ...payload,
    id,
    price: number(payload.price),
    rooms: number(payload.rooms),
    size: number(payload.size),
  });
  setAll(all);
  return { ok: true };
}
export async function updateProperty(id, payload) {
  const all = getAll();
  const i = all.findIndex((x) => x.id == id);
  if (i > -1) all[i] = { ...all[i], ...payload };
  setAll(all);
  return { ok: true };
}
export async function deleteProperty(id) {
  setAll(getAll().filter((x) => x.id != id));
  return { ok: true };
}
