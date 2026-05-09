use tauri_plugin_sql::Migration;

pub fn migration56() -> Migration {
    Migration {
        version: 56,
        description: "add_thumbnail_optimization_queue_metadata",
        sql: r#"
            ALTER TABLE images ADD COLUMN thumbnail_version INTEGER NOT NULL DEFAULT 1;
            ALTER TABLE images ADD COLUMN thumbnail_failure_count INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE images ADD COLUMN thumbnail_last_error TEXT;
            ALTER TABLE images ADD COLUMN thumbnail_last_attempt_at INTEGER;
        "#,
        kind: tauri_plugin_sql::MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration56;

    #[test]
    fn migration_adds_queue_columns_without_startup_queue_work() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                thumbnail_path TEXT,
                thumbnail_source TEXT,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                is_missing INTEGER NOT NULL DEFAULT 0,
                is_intermediate_gen INTEGER NOT NULL DEFAULT 0,
                is_corrupt INTEGER DEFAULT 0,
                timestamp INTEGER NOT NULL
            );

            INSERT INTO images (id, path, thumbnail_path, thumbnail_source, timestamp)
            VALUES
                ('ambit', 'C:/library/ambit.png', 'C:/thumbs/ambit.webp', 'ambit', 2),
                ('invoke', 'C:/library/invoke.png', 'C:/invoke/thumb.webp', 'invokeai', 1);
            ",
        )
        .expect("setup schema");

        conn.execute_batch(migration56().sql)
            .expect("apply migration");

        let ambit_version: i64 = conn
            .query_row(
                "SELECT thumbnail_version FROM images WHERE id = 'ambit'",
                [],
                |row| row.get(0),
            )
            .expect("ambit version");
        let invoke_version: i64 = conn
            .query_row(
                "SELECT thumbnail_version FROM images WHERE id = 'invoke'",
                [],
                |row| row.get(0),
            )
            .expect("invoke version");
        let index_count: i64 = conn
            .query_row(
                "SELECT COUNT(*)
                 FROM sqlite_master
                 WHERE type = 'index'
                   AND name = 'idx_images_thumbnail_optimization_queue_v1'",
                [],
                |row| row.get(0),
            )
            .expect("index count");

        assert_eq!(ambit_version, 1);
        assert_eq!(invoke_version, 1);
        assert_eq!(index_count, 0);
    }
}
