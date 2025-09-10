import {
  normalizeSql,
  isSafeSelect,
  enforceLimit,
  llmTextToSql,
  executeSql,
  llmAnswerFromRows,
} from "../services/qaService.js";
import { DB_PATH } from "../config/db.js";

export async function ask(req, res) {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: "Missing question" });

  try {
    const rawSql = await llmTextToSql(question);
    const cleanSql = normalizeSql(rawSql);
    if (!isSafeSelect(cleanSql)) throw new Error("Unsafe SQL generated");

    const finalSql = enforceLimit(cleanSql);
    const rows = executeSql(DB_PATH, finalSql);
    const answer = await llmAnswerFromRows(question, rows);

    res.json({ sql: finalSql, rows, answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
