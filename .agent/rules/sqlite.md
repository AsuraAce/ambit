---
trigger:
  - "**/*.rs"
  - "**/*.sql"
---

# SQLite Performance & Architecture Standards

## 1. Critical Configuration (The "Safety Harness")
* **Strict Tables:** All new tables MUST be defined with STRICT mode.
    * *Example:* CREATE TABLE images (...) STRICT;
    * *Why:* Prevents subtle type bugs between Rust and SQLite.
* **Foreign Keys:** The database connection setup (in Rust) MUST run PRAGMA foreign_keys = ON; for every connection in the pool.
* **WAL Mode:** Ensure PRAGMA journal_mode = WAL; and PRAGMA synchronous = NORMAL; are active for concurrency.

## 2. Schema Design & Data Modeling
* **Relational > JSON:**
    * **Junction Tables:** NEVER store many-to-many relationships (e.g., Image <-> LoRAs, Tags) as JSON arrays in the main table. Use dedicated junction tables (image_loras, image_tags).
    * **Denormalization:** High-traffic filter fields (e.g., model_hash, spect_ratio) MUST be their own columns, indexed, and not buried in a JSON blob.
* **Generated Columns:** If a field *must* stay in JSON but is queried often, use a STORED generated column to expose it to the indexer.
    * *Example:* cfg_scale REAL GENERATED ALWAYS AS (json_extract(metadata, '$.cfg_scale')) STORED

## 3. Query Performance (The 100k Row Rule)
* **The "No Scan" Policy:** Every query run in the app must hit an index. If a query scans the full images table, it is a bug.
* **Join Strategy:**
    * **Default:** Prefer INNER JOIN over subqueries (IN, EXISTS) for filtering.
    * **"Break Glass" Optimization:** If EXPLAIN QUERY PLAN shows the large table being scanned before the small table, use CROSS JOIN to force the correct order. Do not default to CROSS JOIN.
* **The "ORDER BY + LIMIT" Trap:**
    * *Issue:* SQLite often uses an index to satisfy ORDER BY even if it means scanning 200k rows to find 10 matches.
    * *Fix:* Use a CTE or Materialized View to filter the IDs *first*, then join back to get the data and sort.
* **Pagination:** Usage of OFFSET is banned for the main grid. Use Keyset Pagination (WHERE id < ? ORDER BY id DESC).

## 4. Rust/Tauri Integration
* **Transaction Hygiene:**
    * **Scope:** Keep write transactions (BEGIN IMMEDIATE) as short as possible.
    * **No I/O:** NEVER perform File I/O, Network calls, or heavy computation inside an open DB transaction.
* **Prepared Statements:**
    * Use prepare_cached (in usqlite or sqlx) to prevent recompiling SQL for repeated UI actions.
* **Counts:** Avoid SELECT COUNT(*) on the main view if possible. Use cached stats or collection_counts tables updated via triggers.

## 5. Specialized Workflows
* **Text Search (FTS5):**
    * **No LIKE Scans:** Do not use LIKE '%term%' for searching prompts.
    * **Implementation:** Use FTS5 virtual tables (images_fts) kept in sync via SQL Triggers.
* **JSON Updates:**
    * **Rule:** Bulk updates to JSON blobs (e.g., removing a tag from 10k rows) are BANNED.
    * *Reason:* It forces a rewrite of the entire table file (Write Amplification). Move this data to a junction table.
