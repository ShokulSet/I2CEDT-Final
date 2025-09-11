import { BACKEND_URL } from "./config.js";

// ----- small fetch helper -----
async function request(endpoint, { method = "GET", json, headers = {} } = {}) {
  const res = await fetch(`${BACKEND_URL}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: json ? JSON.stringify(json) : undefined,
  });

  // No content
  if (res.status === 204) return { ok: true };

  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body
    data = text;
  }

  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) ||
      `HTTP ${res.status}: ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
}

// ----- mapping helpers (UI <-> DB) -----
function uiFromDb(r) {
  return {
    id: r.id,
    name: r.description ?? "",     // UI expects "name"
    price: r.price ?? 0,
    rooms: r.bedrooms ?? 0,        // UI expects "rooms"
    size: r.size ?? 0,
    city: r.location ?? "",        // UI expects "city"
    // keep raw fields in case you later show them
    _raw: r,
  };
}

function dbFromUi(p) {
  return {
    // keep falsy/optional fields safe
    description: p.name ?? "",
    price: Number.isFinite(+p.price) ? +p.price : 0,
    location: p.city ?? "",
    type: p.type ?? null,
    size: Number.isFinite(+p.size) ? +p.size : null,
    bedrooms: Number.isFinite(+p.rooms) ? +p.rooms : null,
    bathrooms: Number.isFinite(+p.bathrooms) ? +p.bathrooms : null,
    available_from: p.available_from ?? null,
  };
}

// ====== CRUD bound to backend ======

// GET /listings  -> [{...}]
export async function listProperties() {
  const rows = await request("/listings");
  return Array.isArray(rows) ? rows.map(uiFromDb) : [];
}

// POST /listings -> { id }
export async function createProperty(payload) {
  const body = dbFromUi(payload);
  const out = await request("/listings", { method: "POST", json: body });
  return out; // e.g., { id: newId }
}

// PUT /listings/:id -> { ok: true }
export async function updateProperty(id, payload) {
  const body = dbFromUi(payload);
  return request(`/listings/${encodeURIComponent(id)}`, {
    method: "PUT",
    json: body,
  });
}

// DELETE /listings/:id -> { ok: true }
export async function deleteProperty(id) {
  return request(`/listings/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
