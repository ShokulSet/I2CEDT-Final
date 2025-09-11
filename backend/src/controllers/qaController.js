import {
  llmTextToSql,
  executeSql,
  llmAnswerFromRows,
} from "../services/qaService.js";

/**
 * POST /qa/analyze
 * body: { prompt: string }
 * resp: { prompt, sql, rows, summary }
 */
export const analyze = async (req, res) => {
  try {
    const prompt = String(req.body?.prompt ?? "").trim();
    if (!prompt) {
      return res.status(400).json({ error: "prompt is required" });
    }

    // 1) NL -> SQL (guardrailed inside service)
    const sql = await llmTextToSql(prompt);

    // TODO: make this work
    // if guardrail rejected or LLM didn’t generate valid SELECT
    // if (!sql.trim()) {
    //   return res.json({
    //     prompt,
    //     sql: "",
    //     rows: [],
    //     summary: "SQL generation failed guardrails (no valid SELECT).",
    //   });
    // }

    // 2) Execute on SQLite (read-only SELECT w/ LIMIT)
    const rows = await executeSql(sql);

    // 3) LLM short summary grounded on rows
    const summary = await llmAnswerFromRows(prompt, rows);

    return res.json({ prompt, sql, rows, summary });
  } catch (err) {
    console.error("analyze error:", err);
    return res.status(500).json({ error: "failed to analyze prompt" });
  }
};
