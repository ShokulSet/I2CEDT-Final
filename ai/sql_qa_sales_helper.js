#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Text -> SQL -> Execute -> Answer (Thai)
 * - No frameworks, no npm packages
 * - CSV -> SQLite (via sqlite3 CLI)
 * - LLM (Opentyphoon) for:
 *     1) NL -> SQL (SQL only)
 *     2) Rows -> Thai sales-style answer grounded ONLY on rows
 */
require('dotenv').config(); 
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

// ======== Config ========
const CSV_PATH = process.env.CSV_PATH || 'listings.csv';
const DB_PATH  = process.env.DB_PATH  || path.join(__dirname, 'listings_tmp.db'); // temp DB file
const LLM_ENDPOINT = 'https://api.opentyphoon.ai/v1/chat/completions';
const LLM_API_KEY  = process.env.LLM_API_KEY || ''; // export LLM_API_KEY=...

const MODEL = 'typhoon-v2.1-12b-instruct';

// ======== Helpers ========
function httpPostJson(url, apiKey, payload) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const u = new URL(url);
    const req = https.request({
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': data.length
      },
    }, res => {
      let body = '';
      res.on('data', d => { body += d.toString('utf8'); });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function typhoonChat(messages, {
  max_tokens = 512,
  temperature = 0.2,
  top_p = 0.95,
  repetition_penalty = 1.05,
} = {}) {
  if (!LLM_API_KEY) {
    throw new Error('Please set LLM_API_KEY (export LLM_API_KEY=...)');
  }
  const payload = {
    model: MODEL,
    messages,
    max_tokens,
    temperature,
    top_p,
    repetition_penalty,
    stream: false,
  };
  const json = await httpPostJson(LLM_ENDPOINT, LLM_API_KEY, payload);
  const content = json?.choices?.[0]?.message?.content ?? '';
  return content;
}

// ======== CSV -> SQLite (using sqlite3 CLI) ========
function ensureSqlite3Exists() {
  try {
    execFileSync('sqlite3', ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error('sqlite3 CLI not found. Please install SQLite (sqlite3) and ensure it is on PATH.');
  }
}

/**
 * Creates a fresh DB file and loads the CSV into `listings`.
 * We use `.mode csv` + `.import` in the sqlite3 shell.
 * Not all sqlite3 builds support '--skip 1'; we import, then delete the header row.
 */
function loadCsvIntoSqlite(dbPath, csvPath) {
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


  // 1) create schema
  execFileSync('sqlite3', [dbPath], { input: schemaSQL });

  // 2) import CSV (assumes headers present in CSV)
  //    We'll use .mode csv and .import, then delete the header row by detecting typical header strings.
  const importScript = `
.mode csv
.import ${csvPath} listings
`; // first row (headers) becomes a data row

  execFileSync('sqlite3', [dbPath], { input: importScript });

  // 3) Try to delete the header row if present (best-effort)
  const cleanupSQL = `
DELETE FROM listings
WHERE (location = 'location' AND type = 'type')
   OR (description = 'description' AND price = 'price');
`;
  execFileSync('sqlite3', [dbPath], { input: cleanupSQL });
}

// ======== Guardrail: normalize / validate / enforce LIMIT ========
const DANGEROUS_VERBS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'attach',
  'detach', 'replace', 'vacuum', 'pragma', 'grant', 'revoke'
];

function normalizeSql(text) {
  if (typeof text !== 'string') return '';
  let s = text.trim();

  // Prefer fenced code block
  {
    const m = s.match(/```sql\s*([\s\S]*?)```/i);
    if (m) s = m[1];
  }

  // Keep from first SELECT onward
  {
    const m = s.match(/(select[\s\S]+)$/i);
    s = (m ? m[1] : s).trim();
  }

  // Strip comments
  s = s.replace(/--[^\n]*/g, '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');

  // Strip surrounding odd chars and trailing semicolon
  s = s.replace(/^[`\s]+|[` \t\r\n]+$/g, '');
  if (s.endsWith(';')) s = s.slice(0, -1).trim();

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function isSafeSelect(sql) {
  if (!sql || typeof sql !== 'string') return false;

  const s = normalizeSql(sql);
  if (!s) return false;
  const low = s.toLowerCase();

  // Must start with SELECT
  if (!low.startsWith('select')) return false;

  // No dangerous verbs anywhere
  for (const v of DANGEROUS_VERBS) {
    if (new RegExp(`\\b${v}\\b`, 'i').test(low)) return false;
  }

  // No multiple statements
  if (s.includes(';')) return false;

  // If FROM/JOIN present, table token must be 'listings' (alias allowed)
  const re = /\b(from|join)\b\s+([a-zA-Z_][\w]*)/gi;
  let m;
  while ((m = re.exec(low)) !== null) {
    const table = m[2];
    if (table !== 'listings') return false;
  }
  return true;
}

function enforceLimit(sql, { defaultLimit = 50, maxLimit = 200 } = {}) {
  let s = normalizeSql(sql);
  const low = s.toLowerCase();

  if (!/\blimit\b/i.test(low)) {
    return `${s} LIMIT ${defaultLimit}`;
  }

  // Cap LIMIT n [OFFSET m]
  s = s.replace(/\blimit\s+(\d+)\s*([^\d]\S.*)?$/i, (_all, nStr, rest) => {
    const n = Math.min(parseInt(nStr, 10), maxLimit);
    return `LIMIT ${n}${rest || ''}`;
  });
  return s;
}

// ======== LLM: NL -> SQL (always SELECT *) ========
async function llmTextToSql(question) {
  const systemPrompt =
    "คุณเป็นผู้ช่วย Text-to-SQL สำหรับฐานข้อมูล SQLite ที่มีตารางเดียวชื่อ `listings`.\n" +
    "### กฎสำคัญ\n" +
    "1) ต้องสร้างคำสั่ง SQL ที่ขึ้นต้นด้วย `SELECT *` เท่านั้น และใช้ไวยากรณ์ SQLite\n" +
    "2) ใช้ตาราง `listings` เพียงตารางเดียว (อนุญาตให้ตั้ง alias เช่น l); ห้ามอ้างอิงตารางอื่น\n" +
    "3) ใช้เฉพาะคอลัมน์สำหรับ WHERE/ORDER BY ได้แก่: price, description, location, type, size, bedrooms, bathrooms, available_from, available_year, available_month, available_day\n" +
    "4) ห้ามเลือกคอลัมน์เฉพาะ ต้องใช้ SELECT * เสมอ\n" +
    "5) ต้องมี LIMIT เสมอ (ค่าเริ่มต้น 50 หากผู้ใช้ไม่ระบุ) และไม่มีเครื่องหมาย ; ท้ายคำสั่ง\n" +
    "6) ห้ามมี comment (-- หรือ /* */) และห้ามมีคำอธิบาย เพิ่มเติม ต้องส่งคืนเฉพาะ SQL เท่านั้น\n" +
    "7) ถ้ามีการเปรียบเทียบกับค่าเฉลี่ย/ค่าสถิติ (เช่น AVG, MIN, MAX) ให้ใช้ subquery ใน WHERE เงื่อนไข แต่ SELECT หลักยังคงเป็น SELECT *\n" +
    "8) ถ้ามีการจัดลำดับ ให้ใช้ ORDER BY ตามที่ถาม และยังคงมี LIMIT\n";

  // Few-shot examples to steer the model
  const shots = [
    {
      role: "user",
      content: "แสดงรายการที่ราคาต่ำกว่า 2,000,000 และขนาดใหญ่กว่าค่าเฉลี่ยในกลุ่มราคานี้ จำกัด 50 แถว"
    },
    {
      role: "assistant",
      content:
        "SELECT *\n" +
        "FROM listings\n" +
        "WHERE price <= 2000000\n" +
        "  AND size > (\n" +
        "    SELECT AVG(size) FROM listings WHERE price <= 2000000\n" +
        "  )\n" +
        "LIMIT 50"
    },
    {
      role: "user",
      content: "ขอดูอพาร์ตเมนต์ใน Cairo ที่มีอย่างน้อย 2 ห้องนอน จำกัด 20"
    },
    {
      role: "assistant",
      content:
        "SELECT *\n" +
        "FROM listings\n" +
        "WHERE type = 'apartment' AND location = 'Cairo' AND bedrooms >= 2\n" +
        "LIMIT 20"
    }
  ];

  const userPrompt =
    `คำถาม: ${question}\n` +
    `โปรดส่งคืนเป็น **SQL ที่ขึ้นต้นด้วย SELECT * เพียงคำสั่งเดียว** ตามกฎด้านบน (ห้ามมีคำอธิบายเพิ่ม)`;

  const txt = await typhoonChat([
    { role: 'system', content: systemPrompt },
    ...shots,
    { role: 'user', content: userPrompt },
  ]);

  // Robust extraction: prefer fenced block; else first SELECT onward
  const fence = txt.match(/```sql\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const fromSelect = txt.match(/(select[\s\S]+)$/i);
  return (fromSelect ? fromSelect[1] : txt).trim();
}

// ======== Execute SQL via sqlite3 CLI ========
function executeSql(dbPath, sql) {
  // Use sqlite3 -json to fetch rows as JSON
  const args = ['-json', dbPath, sql];
  const out = execFileSync('sqlite3', args, { encoding: 'utf8' });
  if (!out) return [];
  try { return JSON.parse(out); }
  catch { return []; }
}

// ======== Simple numeric summary ========
function calcSummary(rows) {
  const out = { count: rows.length };
  const prices = rows
    .map(r => r?.price)
    .filter(v => typeof v === 'number' && Number.isFinite(v));
  if (prices.length) {
    out.min_price = Math.min(...prices);
    out.max_price = Math.max(...prices);
    out.avg_price = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100;
  }
  return out;
}

// ======== LLM: Sales helper Thai answer grounded ONLY on rows ========
async function llmAnswerFromRows(question, rows) {
  const rowsForLLM = rows.slice(0, 80);
  const summary = calcSummary(rowsForLLM);

  const systemPrompt =
  "บทบาทของคุณ: ผู้ช่วยฝ่ายขายอสังหาริมทรัพย์ (ภาษาไทยเท่านั้น).\n" +
  "• ใช้ข้อมูลเฉพาะใน 'rows' เท่านั้น ห้ามเดา\n" +
  "• ถ้าข้อมูลไม่พอ ให้บอกว่า 'ไม่มีข้อมูลเพียงพอ'\n" +
  "• ตอบกระชับ ใช้บูลเล็ตเมื่อเหมาะสม\n" +
  "• แสดงจำนวนที่พบ และสรุปราคา (min/max/avg) ถ้ามี\n" +
  "• เสนอ Top 3 ที่ตรงที่สุด พร้อมเหตุผลสั้น ๆ (พิจารณา type/location/price/size/bedrooms/bathrooms/available_from/available_year/available_month/available_day)\n" +
  "• หากมีน้อยกว่า 3 ให้แสดงเท่าที่มี\n" +
  "• หลีกเลี่ยงถ้อยคำเกินจริง และอย่ากล่าวอ้างสิ่งที่ไม่มีใน rows\n";


  const content =
    `คำถามของลูกค้า:\n${question}\n\n` +
    `สรุปตัวเลขที่คำนวณให้แล้ว:\n${JSON.stringify(summary, null, 0)}\n\n` +
    `ข้อมูลทรัพย์ (สูงสุด 80 แถว):\n\`\`\`json\n${JSON.stringify(rowsForLLM, null, 0)}\n\`\`\`\n\n` +
    "รูปแบบคำตอบที่ต้องการ:\n" +
    "1) สรุปภาพรวม\n" +
    "2) Top 3 ที่แนะนำ (price, location, type, size, bedrooms, bathrooms, available_from + เหตุผลย่อ)\n" +
    "3) ข้อสังเกต/ข้อจำกัด (ถ้ามี)\n";

  const txt = await typhoonChat([
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: content },
  ], { max_tokens: 700, temperature: 0.3 });

  return txt;
}

// ======== Pipeline ========
async function askAndAnswer(question) {
  // 1) NL -> SQL
  const rawSql = await llmTextToSql(question);
  console.log('\n--- Raw SQL From LLM ---\n', rawSql);

  // 2) normalize + validate + enforce limit
  const cleanSql = normalizeSql(rawSql);
  if (!isSafeSelect(cleanSql)) {
    throw new Error(`Unsafe/invalid SQL generated:\n${rawSql}`);
  }
  const finalSql = enforceLimit(cleanSql, { defaultLimit: 50, maxLimit: 200 });
  console.log('\n--- Final SQL (normalized + limit) ---\n', finalSql);

  // 3) Execute
  const rows = executeSql(DB_PATH, finalSql);
  console.log(`\n--- Selected Rows --- (showing up to 5 of ${rows.length})`);
  for (const r of rows.slice(0, 5)) console.log(r);

  // 4) Sales-style Thai answer grounded on rows
  const answer = await llmAnswerFromRows(question, rows);
  console.log('\n--- Final Answer (Thai, grounded on rows) ---\n', answer);

  return { sql: finalSql, rows, answer };
}

// ======== Demo ========
(async function main() {
  try {
    if (!fs.existsSync(CSV_PATH)) {
      // create a tiny CSV like the Python sample
      const sample = [
        ['price','description','location','type','size','bedrooms','bathrooms','available_from'],
        [3200000,'2BR in Cairo','Cairo','apartment',110,2,1,'2025-10-01'],
        [15000000,'Villa New Cairo','New Cairo','villa',420,5,4,'2025-09-20'],
        [1200000,'Studio near metro','Maadi','studio',45,0,1,'2025-11-15'],
        [6500000,'Seaview duplex','Alexandria','duplex',180,3,2,'2025-12-01'],
      ];
      fs.writeFileSync(CSV_PATH, sample.map(r => r.join(',')).join('\n'), 'utf8');
      console.log(`Created sample CSV at ${CSV_PATH}`);
    }

    // Build DB
    loadCsvIntoSqlite(DB_PATH, CSV_PATH);

    // Example questions
    const questions = [
      'มีรายการใดบ้างที่มีขนาดมากกว่า 150 ตร.ม. และมีอย่างน้อย 2 ห้องน้ำ',
      'มีงบประมาณ 8,000,000 มีที่ไหนได้เนื้อที่เยอะๆ บ้าง'
    ];

    for (const q of questions) {
      try {
        console.log('\n==============================');
        console.log('Q:', q);
        await askAndAnswer(q);
      } catch (err) {
        console.error('Error:', err.message || err);
      }
    }
  } catch (e) {
    console.error('Fatal:', e.message || e);
    process.exit(1);
  } finally {
    // Keep DB file for inspection; uncomment to auto-delete:
    // try { fs.unlinkSync(DB_PATH); } catch {}
  }
})();