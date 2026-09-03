use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 81: Photo classification and refresh change the rows used by
/// owner-scoped collections. Keep their derived caches coherent without
/// changing the historical migration 78 trigger checksum.
pub fn migration81() -> Migration {
    Migration {
        version: 81,
        description: "invalidate_owner_scope_cache_for_photo_updates",
        sql: r#"
            CREATE TRIGGER invoke_scope_cache_images_photo_update_dirty
            AFTER UPDATE OF
                detected_source_kind, source_kind_override, source_kind,
                photo_metadata_json, capture_wall_time_ms, display_timestamp,
                photo_refresh_version
            ON images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (
                      scope_key IN (
                          SELECT scope_key FROM invoke_scope_cache_visible_image_scopes
                          WHERE image_id = NEW.id
                      )
                      OR (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                      OR (
                          db_path = OLD.invoke_source_id
                          AND (
                              scope_mode IN ('legacy', 'all')
                              OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                          )
                      )
                  );
            END;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration81;

    fn setup() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                detected_source_kind TEXT NOT NULL DEFAULT 'other',
                source_kind_override TEXT,
                source_kind TEXT NOT NULL DEFAULT 'other',
                photo_metadata_json TEXT,
                capture_wall_time_ms INTEGER,
                display_timestamp INTEGER NOT NULL DEFAULT 0,
                photo_refresh_version INTEGER NOT NULL DEFAULT 0,
                invoke_source_id TEXT,
                invoke_scope_hidden INTEGER NOT NULL DEFAULT 0,
                invoke_owner_id TEXT
            );
            CREATE TABLE invoke_scope_cache_control (
                state_key TEXT PRIMARY KEY,
                suppress_invalidation INTEGER NOT NULL
            );
            CREATE TABLE invoke_scope_cache_state (
                scope_key TEXT PRIMARY KEY,
                db_path TEXT NOT NULL,
                scope_mode TEXT NOT NULL,
                owner_id TEXT,
                status TEXT NOT NULL,
                generation INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE VIEW invoke_scope_cache_visible_image_scopes AS
            SELECT i.id AS image_id, cache.scope_key
            FROM images i CROSS JOIN invoke_scope_cache_state cache
            WHERE i.invoke_source_id IS NULL AND i.invoke_scope_hidden = 0;
            INSERT INTO invoke_scope_cache_control VALUES ('current', 0);
            INSERT INTO invoke_scope_cache_state
                VALUES ('scope', 'invoke.db', 'all', NULL, 'ready', 7, 0);
            INSERT INTO images (id) VALUES ('image');
            ",
        )
        .expect("setup schema");
        conn.execute_batch(migration81().sql)
            .expect("apply migration");
        conn
    }

    #[test]
    fn photo_updates_dirty_visible_owner_scope_caches() {
        let conn = setup();
        conn.execute(
            "UPDATE images
             SET source_kind = 'photograph', display_timestamp = 12
             WHERE id = 'image'",
            [],
        )
        .expect("update photo state");

        let state: (String, i64) = conn
            .query_row(
                "SELECT status, generation FROM invoke_scope_cache_state WHERE scope_key = 'scope'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("cache state");
        assert_eq!(state, ("dirty".to_string(), 8));
    }
}
