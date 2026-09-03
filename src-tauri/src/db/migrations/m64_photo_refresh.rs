use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 64: Add a durable per-row checkpoint for filesystem-backed photo
/// metadata adoption. Rows remain pending until a complete scan batch commits,
/// so cancellation or process exit can safely resume later.
pub fn migration64() -> Migration {
    Migration {
        version: 64,
        description: "add_photo_metadata_refresh_checkpoint",
        sql: r#"
            ALTER TABLE images ADD COLUMN photo_refresh_version INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE removed_images ADD COLUMN photo_refresh_version INTEGER NOT NULL DEFAULT 0;

            CREATE INDEX IF NOT EXISTS idx_images_photo_refresh_pending
                ON images(photo_refresh_version, detected_source_kind, id)
                WHERE is_deleted = 0;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration64;

    #[test]
    fn migration_adds_restart_safe_refresh_checkpoint() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                detected_source_kind TEXT NOT NULL DEFAULT 'other'
            );
            CREATE TABLE removed_images (id TEXT PRIMARY KEY);
            INSERT INTO images(id) VALUES ('legacy');
            "#,
        )
        .expect("base schema");

        conn.execute_batch(&migration64().sql)
            .expect("migration 64");

        let version: i64 = conn
            .query_row(
                "SELECT photo_refresh_version FROM images WHERE id = 'legacy'",
                [],
                |row| row.get(0),
            )
            .expect("checkpoint");
        assert_eq!(version, 0);
    }
}
