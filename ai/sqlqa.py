"""
Text -> SQL -> Execute -> Answer (Thai)
- No web framework
- CSV -> SQLite (in-memory) via pandas + sqlite3
- LLM: Opentyphoon chat/completions for both steps:
    1) NL -> SQL (returns SQL only)
    2) Rows -> Final Thai answer grounded ONLY on rows
"""

import os, json, math, sqlite3, pandas as pd
from statistics import mean
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError
import re

CSV_PATH = "listings.csv"
LLM_ENDPOINT = ""
LLM_API_KEY = "sk-e3Zi365AATFEUY8Sq1y2opcBV0eKBqO6mss6BB7tYY2aWJmR"
MODEL = "typhoon-v2.1-12b-instruct"

# ---------------------------
# Load CSV into SQLite memory
# ---------------------------
def load_csv_into_sqlite(path):
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE listings (
      id INTEGER PRIMARY KEY,
      price REAL,
      description TEXT,
      location TEXT,
      type TEXT,
      size REAL,
      bedrooms INTEGER,
      bathrooms INTEGER,
      available_from TEXT
    )
    """)
    df = pd.read_csv(path)
    # basic column check
    expected = {"price","description","location","type","size","bedrooms","bathrooms","available_from"}
    missing = expected - set(df.columns)
    if missing:
        raise ValueError(f"CSV missing columns: {sorted(missing)}")
    df.to_sql("listings", conn, if_exists="append", index=False)
    return conn

# ---------------------------
# Very conservative SQL validator
# ---------------------------
DANGEROUS_VERBS = (
    "insert", "update", "delete", "drop", "alter", "create", "attach",
    "detach", "replace", "vacuum", "pragma", "grant", "revoke"
)

def normalize_sql(text: str) -> str:
    """
    Soften-trim: keep only from the first SELECT onward, remove code fences,
    strip SQL comments, strip trailing semicolons, and collapse whitespace.
    """
    if not isinstance(text, str):
        return ""
    s = text.strip()

    # remove code fences ```sql ... ```
    m = re.search(r"```sql\s*([\s\S]*?)```", s, re.IGNORECASE)
    s = (m.group(1) if m else s)

    # keep from first SELECT onward
    m = re.search(r"(select[\s\S]+)$", s, re.IGNORECASE)
    s = (m.group(1) if m else s).strip()

    # strip -- line comments
    s = re.sub(r"--[^\n]*", "", s)

    # strip /* block */ comments
    s = re.sub(r"/\*[\s\S]*?\*/", "", s)

    # strip surrounding backticks/odd chars
    s = s.strip("` \t\r\n")

    # allow a single trailing semicolon → remove it
    s = s[:-1].strip() if s.endswith(";") else s

    # collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s


def is_safe_select(sql: str) -> bool:
    """
    Softer guard:
      - Must begin with SELECT (case-insensitive)
      - Must NOT contain dangerous verbs (INSERT/UPDATE/... etc.)
      - If there is a FROM/JOIN at top level, every table token must be 'listings' (alias allowed).
        (Subqueries are tolerated; we don't reject them, but we still scan for top-level table tokens.)
      - LIMIT is NOT required here; we'll enforce separately.
      - Allows a single trailing semicolon (handled in normalize_sql).
    """
    if not sql or not isinstance(sql, str):
        return False

    s = normalize_sql(sql)
    if not s:
        return False

    low = s.lower()

    # must start with SELECT
    if not low.startswith("select"):
        return False

    # must not include dangerous verbs anywhere
    if any(re.search(rf"\b{verb}\b", low) for verb in DANGEROUS_VERBS):
        return False

    # Disallow multiple statements (after normalization there shouldn't be ;)
    if ";" in s:
        return False

    # If there are FROM/JOIN tokens, verify table names are 'listings' (alias allowed).
    # This is intentionally soft: it ignores subquery parentheses.
    # Examples allowed: "FROM listings", "FROM listings l", "JOIN listings AS x"
    # Examples rejected: "FROM users", "JOIN agents"
    for m in re.finditer(r"\b(from|join)\b\s+([a-zA-Z_][\w]*)", low):
        table = m.group(2)
        if table != "listings":
            return False

    return True


def enforce_limit(sql: str, default_limit: int = 50, max_limit: int = 200) -> str:
    """
    Ensure there's a LIMIT; if too large, cap it.
    Handles forms: LIMIT n, LIMIT n OFFSET m
    """
    s = normalize_sql(sql)
    low = s.lower()

    # If no LIMIT → append default
    if re.search(r"\blimit\b", low) is None:
        return f"{s} LIMIT {default_limit}"

    # Cap numeric LIMIT if present
    def _cap(match):
        # variants: "limit 100", "limit 100 offset 10"
        limit_num = int(match.group(1))
        capped = min(limit_num, max_limit)
        rest = match.group(2) or ""
        return f"LIMIT {capped}{rest}"

    s = re.sub(r"\blimit\s+(\d+)\s*([^\d]\S.*)?$", _cap, s, flags=re.IGNORECASE)
    return s

    return True

# ---------------------------
# Typhoon Chat Completion helper
# ---------------------------
def typhoon_chat(messages, max_tokens=512, temperature=0.2, top_p=0.95, repetition_penalty=1.05):
    if not LLM_API_KEY:
        raise RuntimeError("Please set LLM_API_KEY (export LLM_API_KEY=...)")
    payload = {
        "model": MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": top_p,
        "repetition_penalty": repetition_penalty,
        "stream": False
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urlrequest.Request(
        LLM_ENDPOINT,
        data=data,
        headers={
            "Authorization": f"Bearer {LLM_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlrequest.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            j = json.loads(raw)
            return j["choices"][0]["message"]["content"]
    except HTTPError as e:
        raise RuntimeError(f"HTTPError {e.code}: {e.read().decode('utf-8','ignore')}")
    except URLError as e:
        raise RuntimeError(f"URLError: {e}")

# ---------------------------
# 1) NL -> SQL (Thai system prompt, but output must be SQL only)
# ---------------------------
def llm_text_to_sql(question: str) -> str:
    system_prompt = (
        "คุณเป็นผู้ช่วย Text-to-SQL สำหรับฐานข้อมูล SQL ที่มีตารางเดียวชื่อ `listings`.\n"
        "### กฎสำคัญ:\n"
        "1. ต้องสร้างคำสั่ง SQL ที่ขึ้นต้นด้วย `SELECT` เท่านั้น\n"
        "2. ต้องใช้ตาราง `listings` เพียงตารางเดียว (อนุญาตให้มี alias เช่น l ได้ แต่ห้ามใช้ชื่อตารางอื่น)\n"
        "3. ต้องใช้เฉพาะคอลัมน์เหล่านี้: price, description, location, type, size, bedrooms, bathrooms, available_from\n"
        "4. ต้องมี `LIMIT` อยู่เสมอ (ค่าเริ่มต้น 50 ถ้าไม่ระบุ)\n"
        "5. ห้ามมี `;` หลายคำสั่ง, ห้ามมี comment (--, /* ... */)\n"
        "6. ห้ามใส่ข้อความอธิบายหรือคำพูดอื่น ๆ — ต้องส่งคืนเฉพาะ SQL อย่างเดียว\n"
        "7. ใช้ไวยากรณ์ SQL เท่านั้น\n"
    )

    user_prompt = f"คำถาม: {question}\nโปรดส่งคืนเป็น SQL ที่ถูกต้องตามกฎด้านบน"

    txt = typhoon_chat([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ])

    # strip code fences if any
    import re
    m = re.search(r"```sql\s*([\s\S]*?)```", txt, re.I)
    sql = (m.group(1) if m else txt).strip()
    return sql

# ---------------------------
# Execute SQL and return rows as dicts
# ---------------------------
def execute_sql(conn, sql: str):
    if not is_safe_select(sql):
        raise ValueError(f"Unsafe/invalid SQL generated:\n{sql}")
    cur = conn.cursor()
    cur.execute(sql)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]

# ---------------------------
# Small numeric summary (deterministic helpers)
# ---------------------------
def calc_summary(rows):
    out = {"count": len(rows)}
    prices = [r.get("price") for r in rows if isinstance(r.get("price"), (int,float))]
    if prices:
        out["min_price"] = min(prices)
        out["max_price"] = max(prices)
        out["avg_price"] = round(mean(prices), 2)
    return out

# ---------------------------
# 2) Final answer grounded on rows (Thai) — Sales helper style + Top 3
# ---------------------------
def llm_answer_from_rows(question: str, rows: list):
    """
    Sales-oriented Thai summary grounded ONLY on provided rows.
    Produces a quick overview + Top 3 matches with brief reasons.
    """
    rows_for_llm = rows[:80]  # keep payload small
    summary = calc_summary(rows_for_llm)

    system_prompt = (
        "บทบาทของคุณ: ผู้ช่วยฝ่ายขายอสังหาริมทรัพย์ (ภาษาไทยเท่านั้น).\n"
        "ข้อกำหนดสำคัญ:\n"
        "• ใช้ข้อมูลเฉพาะในตัวแปร 'rows' ที่ให้มาเท่านั้น ห้ามเดาหรือเสริมข้อมูลนอกเหนือจากนี้\n"
        "• หากข้อมูลไม่เพียงพอ ให้ระบุว่า 'ไม่มีข้อมูลเพียงพอ' อย่างชัดเจน\n"
        "• คำตอบควรกระชับ อ่านง่าย ใช้บูลเล็ตเมื่อเหมาะสม\n"
        "• ระบุจำนวนรายการที่พบ (count) และสรุปราคา (min/max/avg) ถ้ามีให้ใช้\n"
        "• นำเสนอ 'Top 3' ทรัพย์ที่ตรงคำถามมากที่สุด พร้อมเหตุผลสั้น ๆ ว่าทำไมจึงเหมาะ\n"
        "• การจัดอันดับให้พิจารณาความสอดคล้องกับเจตนาคำถาม เช่น: ประเภท(type), ทำเล(location), "
        "งบประมาณ(price), ขนาด(size), ห้องนอน/ห้องน้ำ (bedrooms/bathrooms), วันเข้าพักได้(available_from).\n"
        "• ถ้าจำนวนรายการ < 3 ให้แสดงเท่าที่มี\n"
        "• หลีกเลี่ยงถ้อยคำโฆษณาเกินจริง และอย่ากล่าวอ้างสิ่งที่ไม่มีในแถวข้อมูล\n"
    )

    content = (
        "คำถามของลูกค้า:\n"
        f"{question}\n\n"
        "สรุปตัวเลขที่คำนวณให้แล้ว:\n"
        f"{json.dumps(summary, ensure_ascii=False)}\n\n"
        "ข้อมูลทรัพย์ (สูงสุด 80 แถว):\n"
        "```json\n"
        f"{json.dumps(rows_for_llm, ensure_ascii=False)}\n"
        "```\n\n"
        "รูปแบบคำตอบที่ต้องการ:\n"
        "1) สรุปภาพรวม (จำนวนรายการที่พบ ช่วงราคา ราคาเฉลี่ย ข้อมูลเชิงสรุปที่มี)\n"
        "2) Top 3 ที่แนะนำ (รายการละ 1–3 บรรทัด): ให้แสดง price, location, type, size, bedrooms, bathrooms, available_from และ 'เหตุผลย่อ'\n"
        "3) ข้อสังเกต/ข้อจำกัด (ถ้ามี เช่น ข้อมูลไม่ระบุบางคอลัมน์)\n"
        "หมายเหตุ: ห้ามอ้างอิงข้อมูลอื่นนอกเหนือจากใน rows\n"
    )

    txt = typhoon_chat([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": content},
    ], max_tokens=700, temperature=0.3)

    return txt


# ---------------------------
# One-call convenience
# ---------------------------
def ask_and_answer(conn, question: str):
    # Step 1: NL -> SQL
    sql = llm_text_to_sql(question)
    print("\n--- Generated SQL ---\n", sql)

    # Step 2: Execute
    rows = execute_sql(conn, sql)
    print(f"\n--- Selected Rows --- (showing up to 5 of {len(rows)})")
    for r in rows[:5]:
        print(r)

    # Step 3: Thai answer grounded on rows
    answer = llm_answer_from_rows(question, rows)
    print("\n--- Final Answer (Thai, grounded on rows) ---\n", answer)

    return {"sql": sql, "rows": rows, "answer": answer}

# ---------------------------
# Demo
# ---------------------------
if __name__ == "__main__":
    # Create a tiny CSV if missing
    if not os.path.exists(CSV_PATH):
        sample = [
            {"price": 3200000, "description": "2BR in Cairo",      "location": "Cairo",       "type": "apartment", "size": 110, "bedrooms": 2, "bathrooms": 1, "available_from": "2025-10-01"},
            {"price":15000000, "description": "Villa New Cairo",    "location": "New Cairo",   "type": "villa",     "size": 420, "bedrooms": 5, "bathrooms": 4, "available_from": "2025-09-20"},
            {"price": 1200000, "description": "Studio near metro",  "location": "Maadi",       "type": "studio",    "size": 45,  "bedrooms": 0, "bathrooms": 1, "available_from": "2025-11-15"},
            {"price": 6500000, "description": "Seaview duplex",     "location": "Alexandria",  "type": "duplex",    "size": 180, "bedrooms": 3, "bathrooms": 2, "available_from": "2025-12-01"},
        ]
        pd.DataFrame(sample).to_csv(CSV_PATH, index=False)
        print(f"Created sample CSV at {CSV_PATH}")

    conn = load_csv_into_sqlite(CSV_PATH)

    # EXAMPLES
    questions = [
        "ขอดูอพาร์ตเมนต์ในไคโรที่ราคาต่ำกว่า 5,000,000 และมีอย่างน้อย 2 ห้องนอน เรียงจากแพงไปถูก",
        "สรุปราคาเฉลี่ย แพงสุด ถูกสุด ของบ้านประเภท villa ใน New Cairo จำกัด 20 แถว",
        "มีรายการใดบ้างที่มีขนาดมากกว่า 150 ตร.ม. และมีอย่างน้อย 2 ห้องน้ำ",
    ]
    for q in questions:
        try:
            print("\n==============================")
            print("Q:", q)
            ask_and_answer(conn, q)
        except Exception as e:
            print("Error:", e)
