use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 55: Add index for manual thumbnail lookup during facet rebuilds.
pub fn migration55() -> Migration {
    Migration {
        version: 55,
        description: "add_manual_thumbnail_lookup_index",
        sql: r#"
            CREATE INDEX IF NOT EXISTS idx_images_thumbnail_path_lookup_v1
                ON images(thumbnail_path)
                WHERE thumbnail_path IS NOT NULL AND thumbnail_path != '';
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration55;

    #[test]
    fn migration_adds_manual_thumbnail_lookup_index() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                thumbnail_path TEXT,
                thumbnail_source TEXT
            );
            ",
        )
        .expect("setup schema");

        conn.execute_batch(migration55().sql)
            .expect("apply migration");

        let index_count: i64 = conn
            .query_row(
                "SELECT COUNT(*)
                 FROM sqlite_master
                 WHERE type = 'index'
                   AND name = 'idx_images_thumbnail_path_lookup_v1'",
                [],
                |row| row.get(0),
            )
            .expect("index count");

        assert_eq!(index_count, 1);
    }
}
