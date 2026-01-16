---
name: manage_db_schema
description: Protocol for making changes to the SQLite database schema and updating the application.
---

# Manage DB Schema Skill

Use this skill whenever you need to add tables, columns, or change the structure of `library.db`.

## 1. Create Migration
Modify `src-tauri/src/db/migrations.rs`.

Add a new migration step to the list. 
**CRITICAL**: Increment the migration version number.

Example:
```rust
// In migrations.rs
pub const MIGRATIONS: &[(&str, &str)] = &[
    // ... previous migrations
    ("1.0.5", "ALTER TABLE images ADD COLUMN is_favorite BOOLEAN DEFAULT 0;"),
];
```

## 2. Update Rust Structs
If the schema change affects data models, update the corresponding structs in `src-tauri/src/db/models.rs` or relevant files.

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct Image {
    // ...
    pub is_favorite: bool,
}
```

## 3. Update Frontend Helpers
Update `src/utils/sqlHelpers.ts` to reflect the new schema in queries.

- If you added a column, ensure `SELECT *` or specific `SELECT` lists include it if needed (though `*` usually covers it, strictly typed mappers might need updates).
- Update any `CREATE` or `UPDATE` query builders.

## 4. Verify Persistence
- Restart the application.
- Verify `library.db` has the new schema (using `sqlite3` CLI or by checking app logs).
- Test inserting and retrieving data with the new fields.

## 5. Checklist
- [ ] **Migration Added**: New SQL in `migrations.rs`?
- [ ] **Version Bumped**: Unique version string?
- [ ] **Structs Updated**: Rust structs match new schema?
- [ ] **Frontend Updated**: `sqlHelpers.ts` and interfaces updated?
- [ ] **Data Preserved**: Confirmed existing data wasn't wiped (unless intended)?
