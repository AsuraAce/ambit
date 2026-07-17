use tauri_plugin_sql::Migration;

/// Migration 62: Cache the last calculated count for smart collections.
pub fn migration62() -> Migration {
    Migration {
        version: 62,
        description: "add_smart_collection_count_cache",
        sql: r#"
            ALTER TABLE collections ADD COLUMN dynamic_count INTEGER;
        "#,
        kind: tauri_plugin_sql::MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration62;

    #[test]
    fn migration_adds_nullable_dynamic_count_and_preserves_existing_rows() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE collections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            INSERT INTO collections (id, name, created_at)
            VALUES ('existing', 'Existing collection', 123);
            ",
        )
        .expect("setup schema");

        conn.execute_batch(migration62().sql)
            .expect("apply migration");

        let column: (String, String, i64) = conn
            .query_row(
                "SELECT name, type, \"notnull\"
                 FROM pragma_table_info('collections')
                 WHERE name = 'dynamic_count'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("dynamic_count column");

        assert_eq!(column, ("dynamic_count".into(), "INTEGER".into(), 0));

        let existing: (String, String, i64, Option<i64>) = conn
            .query_row(
                "SELECT id, name, created_at, dynamic_count
                 FROM collections
                 WHERE id = 'existing'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("existing collection");

        assert_eq!(
            existing,
            ("existing".into(), "Existing collection".into(), 123, None)
        );
    }
}
