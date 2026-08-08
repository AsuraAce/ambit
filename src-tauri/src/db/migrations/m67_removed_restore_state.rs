use tauri_plugin_sql::{Migration, MigrationKind};

/// Preserve derived state that is expensive or version-sensitive across remove/restore.
pub fn migration67() -> Migration {
    Migration {
        version: 67,
        description: "preserve_removed_restore_state",
        sql: "
            ALTER TABLE removed_images ADD COLUMN file_hash TEXT;
            ALTER TABLE removed_images ADD COLUMN parser_version INTEGER;
        ",
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration67;
    use rusqlite::Connection;

    #[test]
    fn migration_adds_nullable_restore_state_without_changing_existing_tombstones() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE removed_images (
                id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL
             ) STRICT;
             INSERT INTO removed_images (id, path) VALUES ('image', 'C:/image.png');",
        )
        .unwrap();

        conn.execute_batch(&migration67().sql).unwrap();

        let restored_state: (Option<String>, Option<i64>) = conn
            .query_row(
                "SELECT file_hash, parser_version FROM removed_images WHERE id = 'image'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(restored_state, (None, None));
    }
}
