import https from "https";
import { execFileSync } from "child_process";

// ---------------------
// Config
// ---------------------
const LLM_ENDPOINT = "https://api.opentyphoon.ai/v1/chat/completions";
const MODEL = "typhoon-v2.1-12b-instruct";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const DB_PATH = process.env.DB_PATH || "listings_tmp.db";

// ---------------------
// Low-level HTTP + LLM
// ---------------------
function httpPostJson(url, apiKey, payload) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload), "utf8");
    const u = new URL(url);
    const req = https.request({
      method: "POST",
      hostname: u.hostname,
      path: u.pathname + (u.search || ""),
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": data.length
      }
    }, res => {
      let body = "";
      res.on("data", d => body += d.toString("utf8"));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(body));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
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

// ---------------------
// SQL Guardrails
// ---------------------
function normalizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function isSafeSelect(sql) {
  const upper = sql.toUpperCase();
  if (!upper.startsWith("SELECT")) return false;
  if (
    upper.includes("DELETE") ||
    upper.includes("UPDATE") ||
    upper.includes("INSERT") ||
    upper.includes("DROP")
  ) {
    return false;
  }
  return true;
}

function enforceLimit(sql, limit = 20) {
  const upper = sql.toUpperCase();
  if (!upper.includes("LIMIT")) {
    return `${sql} LIMIT ${limit}`;
  }
  return sql;
}

// ---------------------
// SQL Generation + Exec
// ---------------------
async function llmTextToSql(question) {
  const schemaPrompt = `
  ตาราง listings(columns):
    - price (INTEGER, ราคา)
    - description (TEXT, คำอธิบาย)
    - location (TEXT, ทำเล)
    - type (TEXT, apartment/villa/studio/duplex)
    - size (INTEGER, พื้นที่ ตร.ม.)
    - bedrooms (INTEGER)
    - bathrooms (INTEGER)
    - available_from (DATE)
  `;
  const messages = [
    { role: "system", content: "You are a SQL expert. Generate only a SQLite SELECT query." },
    { role: "user", content: `${schemaPrompt}\n\nQuestion: ${question}` }
  ];
  const sql = await typhoonChat(messages);
  return normalizeSql(sql);
}

function executeSql(sql) {
  sql = enforceLimit(sql, 20);
  const out = execFileSync("sqlite3", ["-header", "-csv", DB_PATH, sql]);
  const text = out.toString("utf8").trim();
  if (!text) return [];
  const [headerLine, ...rows] = text.split("\n");
  const headers = headerLine.split(",");
  return rows.map(line => {
    const cols = line.split(",");
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i]; });
    return obj;
  });
}

// ---------------------
// LLM Answering
// ---------------------
async function llmAnswerFromRows(question, rows) {
  const messages = [
    { role: "system", content: "คุณคือผู้ช่วยอสังหาริมทรัพย์ ตอบสั้นๆ ชัดเจน" },
    { role: "user", content: `คำถาม: ${question}\n\nข้อมูล: ${JSON.stringify(rows, null, 2)}` }
  ];
  return typhoonChat(messages);
}

// ---------------------
// Exports
// ---------------------
export {
  normalizeSql,
  isSafeSelect,
  enforceLimit,
  llmTextToSql,
  executeSql,
  llmAnswerFromRows
};
