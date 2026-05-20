use tauri_plugin_sql::Migration;

pub fn migration57() -> Migration {
    Migration {
        version: 57,
        description: "add_collection_dynamic_thumbnail_cache",
        sql: r#"
            ALTER TABLE collections ADD COLUMN dynamic_thumbnail_path TEXT;
            ALTER TABLE collections ADD COLUMN dynamic_safe_thumbnail_path TEXT;
            ALTER TABLE collections ADD COLUMN dynamic_thumbnail_is_sensitive INTEGER;
            ALTER TABLE collections ADD COLUMN dynamic_thumbnail_cached_at INTEGER;
        "#,
        kind: tauri_plugin_sql::MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration57;

    #[test]
    fn migration_adds_nullable_dynamic_thumbnail_cache_columns() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE collections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT,
                is_archived INTEGER NOT NULL DEFAULT 0,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                filter_state TEXT,
                manual_exclusions TEXT,
                custom_thumbnail TEXT,
                source TEXT NOT NULL DEFAULT 'ambit',
                updated_at INTEGER
            );
            ",
        )
        .expect("setup schema");

        conn.execute_batch(migration57().sql)
            .expect("apply migration");

        let mut stmt = conn
            .prepare("PRAGMA table_info(collections)")
            .expect("prepare table info");
        let columns: Vec<(String, i64)> = stmt
            .query_map([], |row| Ok((row.get(1)?, row.get(3)?)))
            .expect("query columns")
            .collect::<Result<_, _>>()
            .expect("collect columns");

        for column_name in [
            "dynamic_thumbnail_path",
            "dynamic_safe_thumbnail_path",
            "dynamic_thumbnail_is_sensitive",
            "dynamic_thumbnail_cached_at",
        ] {
            let (_, not_null) = columns
                .iter()
                .find(|(name, _)| name == column_name)
                .unwrap_or_else(|| panic!("missing column {column_name}"));
            assert_eq!(*not_null, 0, "{column_name} should be nullable");
        }
    }
}
