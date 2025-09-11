// src/database/db.js
import path from "path";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

sqlite3.verbose();

let dbPromise = null;

// Resolve __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Returns a singleton sqlite connection to listings_tmp.db
 * Path resolution:
 *  - ENV DB_PATH if provided
 *  - otherwise src/database/listings_tmp.db (this folder)
 */
export function getDb() {
  if (!dbPromise) {
    const defaultDbPath = path.resolve(__dirname, "./listings_tmp.db");
    const filename = process.env.DB_PATH || defaultDbPath;

    dbPromise = open({
      filename,
      driver: sqlite3.Database,
    });
  }
  return dbPromise;
}

/** Convenience helper for SELECTs */
export async function select(sql, params = []) {
  const db = await getDb();
  return db.all(sql, params);
}

/** (Optional) run writes if you ever need them; not used here */
export async function run(sql, params = []) {
  const db = await getDb();
  return db.run(sql, params);
}
