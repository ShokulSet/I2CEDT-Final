// src/services/qaService.js
import https from "https";
// NOTE: no more child_process or sqlite3 CLI
import { select } from "../database/db.js";

// ---------------------
// Config
// ---------------------
const LLM_ENDPOINT = "https://api.opentyphoon.ai/v1/chat/completions";
const MODEL = "typhoon-v2.1-12b-instruct";
const LLM_API_KEY = process.env.LLM_API_KEY;

// ---------------------
// Low-level HTTP + LLM
// ---------------------
function httpPostJson(url, apiKey, payload) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload), "utf8");
    const u = new URL(url);
    const req = https.request(
      {
        method: "POST",
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": data.length,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d.toString("utf8")));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(body));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function typhoonChat(
  messages,
  {
    max_tokens = 1024,
    temperature = 0.2,
    top_p = 0.95,
    repetition_penalty = 1.05,
  } = {},
) {
  if (!LLM_API_KEY) {
    throw new Error("Please set LLM_API_KEY (export LLM_API_KEY=...)");
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
  const content = json?.choices?.[0]?.message?.content ?? "";
  return content;
}

// ---------------------
// SQL Guardrails
// ---------------------
function normalizeSql(text) {
  if (typeof text !== "string") return "";
  let s = text.trim();

  // 1) Prefer fenced code blocks labeled sql|sqlite (case-insensitive)
  //    Handles: ```sql ...```, ```SQL ...```, ```sqlite ...```
  {
    const m = s.match(/```(?:\s*)(sql|sqlite)\b[^\n]*\n([\s\S]*?)```/i);
    if (m) s = m[2].trim();
    else {
      // If no labeled fence, try any fence and only keep if it contains SELECT
      const m2 = s.match(/```([\s\S]*?)```/);
      if (m2 && /select\s/i.test(m2[1])) s = m2[1].trim();
    }
  }

  // 2) If still mixed prose, keep from FIRST SELECT onward
  {
    const m = s.match(/(select[\s\S]*)$/i);
    s = (m ? m[1] : s).trim();
  }

  // 3) Strip sqlite shell prompts and continuations:
  //    e.g., "sqlite> SELECT ...", "...> AND price > 0"
  s = s
    .split(/\r?\n/)
    .map((line) =>
      line.replace(
        /^\s*(sqlite>|\.shell\b|\.headers\b|\.mode\b|\.\w+>|\.\w+)\s*/i,
        "",
      ),
    )
    .map((line) => line.replace(/^\s*\.\.\.>\s*/, "")) // generic continuation prompt
    .join("\n");

  // 4) Remove comments (line + block)
  s = s.replace(/--[^\n]*/g, "");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");

  // 5) Drop surrounding backticks/whitespace and trailing semicolon
  s = s.replace(/^[`\s]+|[` \t\r\n]+$/g, "");
  if (s.endsWith(";")) s = s.slice(0, -1);

  // 6) Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  // 7) Final safety: ensure it's a SELECT; otherwise empty
  if (!/^select\b/i.test(s)) return "";

  return s;
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
  // Match your actual schema exactly (per your message)
  const schemaPrompt = `
  ตาราง listings (columns):
    - id (INTEGER, PRIMARY KEY)
    - price (REAL, ราคา)
    - description (TEXT, คำอธิบาย)
    - location (TEXT, ทำเล)
    - type (TEXT, apartment/villa/studio/duplex)
    - size (REAL, พื้นที่ ตร.ม.)
    - bedrooms (INTEGER)
    - bathrooms (INTEGER)
    - available_from (TEXT, วันที่พร้อมเข้าอยู่)
  `;
  const messages = [
    {
      role: "system",
      content:
        "You are a SQL expert. Generate only a valid SQLite SELECT query over the 'listings' table. No comments, no explanation.",
    },
    { role: "user", content: `${schemaPrompt}\n\nQuestion: ${question}` },
  ];
  const sql = await typhoonChat(messages);
  return normalizeSql(sql);
}

/**
 * Executes a SELECT safely via the sqlite driver (no shelling out).
 * Returns rows as array of objects.
 */
async function executeSql(sql) {
  sql = enforceLimit(sql, 20);
  if (!isSafeSelect(sql)) {
    throw new Error("Unsafe or non-SELECT SQL rejected.");
  }
  // No params here because the LLM outputs a complete SELECT.
  const rows = await select(sql, []);
  return rows ?? [];
}

// ---------------------
// LLM Answering
// ---------------------
async function llmAnswerFromRows(question, rows) {
  const messages = [
    { role: "system", content: "คุณคือผู้ช่วยอสังหาริมทรัพย์ ตอบสั้นๆ ชัดเจน" },
    {
      role: "user",
      content: `คำถาม: ${question}\n\nข้อมูล (อิงจากฐานข้อมูลเท่านั้น):\n${JSON.stringify(
        rows,
        null,
        2,
      )}`,
    },
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
  executeSql, // now async
  llmAnswerFromRows,
};
