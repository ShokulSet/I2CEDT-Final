import { getDb } from "../database/db.js";

export const getAllListings = async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all("SELECT * FROM listings ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch listings" });
  }
};

export const createListing = async (req, res) => {
  try {
    const {
      description,
      price,
      location,
      type,
      size,
      bedrooms,
      bathrooms,
      available_from,
    } = req.body;
    const db = await getDb();
    const result = await db.run(
      `INSERT INTO listings (description, price, location, type, size, bedrooms, bathrooms, available_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        description,
        price,
        location,
        type,
        size,
        bedrooms,
        bathrooms,
        available_from,
      ],
    );
    res.status(201).json({ id: result.lastID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create listing" });
  }
};

export const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      description,
      price,
      location,
      type,
      size,
      bedrooms,
      bathrooms,
      available_from,
    } = req.body;
    const db = await getDb();
    await db.run(
      `UPDATE listings
       SET description=?, price=?, location=?, type=?, size=?, bedrooms=?, bathrooms=?, available_from=?
       WHERE id=?`,
      [
        description,
        price,
        location,
        type,
        size,
        bedrooms,
        bathrooms,
        available_from,
        id,
      ],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update listing" });
  }
};

export const deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    await db.run("DELETE FROM listings WHERE id=?", [id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete listing" });
  }
};
