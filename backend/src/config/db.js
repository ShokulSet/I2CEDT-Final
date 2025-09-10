import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const CSV_PATH =
  process.env.CSV_PATH || path.join(process.cwd(), "listings.csv");
const DB_PATH =
  process.env.DB_PATH || path.join(process.cwd(), "listings_tmp.db");

function ensureSqlite3Exists() {
  try {
    execFileSync("sqlite3", ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error("sqlite3 CLI not found. Please install SQLite.");
  }
}

function loadCsvIntoSqlite(dbPath = DB_PATH, csvPath = CSV_PATH) {
  ensureSqlite3Exists();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const schemaSQL = `
DROP TABLE IF EXISTS listings;
CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  price REAL,
  description TEXT,
  location TEXT,
  type TEXT,
  size REAL,
  bedrooms INTEGER,
  bathrooms INTEGER,
  available_from TEXT,
  available_year INTEGER,
  available_month INTEGER,
  available_day INTEGER
);
`;
  execFileSync("sqlite3", [dbPath], { input: schemaSQL });

  const importScript = `
.mode csv
.import ${csvPath} listings
`;
  execFileSync("sqlite3", [dbPath], { input: importScript });

  const cleanupSQL = `
DELETE FROM listings
WHERE (location = 'location' AND type = 'type')
   OR (description = 'description' AND price = 'price');
`;
  execFileSync("sqlite3", [dbPath], { input: cleanupSQL });
}

export { DB_PATH, CSV_PATH, loadCsvIntoSqlite };
