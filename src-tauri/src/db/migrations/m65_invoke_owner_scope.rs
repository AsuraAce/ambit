use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 65: Persist InvokeAI owner facts and fail-closed visibility state.
pub fn migration65() -> Migration {
    Migration {
        version: 65,
        description: "add_invoke_owner_scope",
        sql: r#"
            ALTER TABLE images ADD COLUMN invoke_owner_id TEXT;
            ALTER TABLE images ADD COLUMN invoke_scope_hidden INTEGER NOT NULL DEFAULT 0
                CHECK (invoke_scope_hidden IN (0, 1));

            ALTER TABLE removed_images ADD COLUMN invoke_owner_id TEXT;
            ALTER TABLE removed_images ADD COLUMN invoke_scope_hidden INTEGER NOT NULL DEFAULT 0
                CHECK (invoke_scope_hidden IN (0, 1));

            UPDATE images
            SET invoke_scope_hidden = 1
            WHERE invoke_image_name IS NOT NULL;

            UPDATE removed_images
            SET invoke_scope_hidden = 1
            WHERE invoke_image_name IS NOT NULL;

            -- Cached facet names and collection thumbnails can reveal hidden owners
            -- before the startup reconciliation has a chance to rebuild them.
            DELETE FROM facet_cache;
            UPDATE collections
            SET dynamic_thumbnail_path = NULL,
                dynamic_safe_thumbnail_path = NULL,
                dynamic_thumbnail_is_sensitive = NULL,
                dynamic_thumbnail_cached_at = NULL
            WHERE custom_thumbnail IS NULL OR custom_thumbnail = '';
            UPDATE collections SET dynamic_count = NULL WHERE filter_state IS NOT NULL;

            CREATE TABLE invoke_owner_scope_state (
                state_key TEXT PRIMARY KEY CHECK (state_key = 'current'),
                db_path TEXT NOT NULL,
                images_root TEXT NOT NULL,
                scope_mode TEXT NOT NULL
                    CHECK (scope_mode IN ('legacy', 'unselected', 'owner', 'all')),
                owner_id TEXT,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX idx_images_invoke_owner_id
                ON images(invoke_owner_id);
            CREATE INDEX idx_removed_images_invoke_owner_id
                ON removed_images(invoke_owner_id);
            CREATE INDEX idx_removed_images_invoke_scope_removed_at
                ON removed_images(invoke_scope_hidden, removed_at DESC);
            CREATE INDEX idx_images_invoke_scope_fast_sort_v1
                ON images(
                    invoke_scope_hidden,
                    is_deleted,
                    IFNULL(is_intermediate_gen, 0),
                    IFNULL(is_grid_gen, 0),
                    IFNULL(is_invoke_asset_gen, 0),
                    timestamp DESC,
                    id DESC
                );
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration65;
    use rusqlite::Connection;

    fn source_schema() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                timestamp INTEGER NOT NULL,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                is_intermediate_gen INTEGER NOT NULL DEFAULT 0,
                is_grid_gen INTEGER NOT NULL DEFAULT 0,
                is_invoke_asset_gen INTEGER,
                invoke_image_name TEXT
            );
            CREATE TABLE removed_images (
                id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                timestamp INTEGER NOT NULL,
                removed_at INTEGER NOT NULL,
                invoke_image_name TEXT
            );
            CREATE TABLE facet_cache (
                facet_type TEXT NOT NULL,
                resource_name TEXT NOT NULL
            );
            CREATE TABLE collections (
                id TEXT PRIMARY KEY,
                custom_thumbnail TEXT,
                filter_state TEXT,
                dynamic_thumbnail_path TEXT,
                dynamic_safe_thumbnail_path TEXT,
                dynamic_thumbnail_is_sensitive INTEGER,
                dynamic_thumbnail_cached_at INTEGER,
                dynamic_count INTEGER
            );
            ",
        )
        .expect("source schema");
        conn
    }

    #[test]
    fn existing_invoke_rows_start_hidden_without_hiding_other_images() {
        let conn = source_schema();
        conn.execute_batch(
            "
            INSERT INTO images (id, path, timestamp, invoke_image_name)
                VALUES ('invoke', 'C:/invoke.png', 1, 'invoke.png');
            INSERT INTO images (id, path, timestamp)
                VALUES ('other', 'C:/other.png', 2);
            INSERT INTO removed_images (id, path, timestamp, removed_at, invoke_image_name)
                VALUES ('removed', 'C:/removed.png', 3, 4, 'removed.png');
            INSERT INTO facet_cache (facet_type, resource_name)
                VALUES ('tools', 'Other owner tool');
            INSERT INTO collections (
                id, filter_state, dynamic_thumbnail_path, dynamic_safe_thumbnail_path,
                dynamic_thumbnail_is_sensitive, dynamic_thumbnail_cached_at, dynamic_count
            ) VALUES ('dynamic', '{}', 'C:/hidden.webp', 'C:/hidden-safe.webp', 0, 99, 42);
            INSERT INTO collections (
                id, custom_thumbnail, dynamic_thumbnail_path, dynamic_thumbnail_cached_at
            ) VALUES ('custom', 'C:/chosen.webp', 'C:/keep-cache.webp', 99);
            ",
        )
        .expect("seed rows");

        conn.execute_batch(migration65().sql)
            .expect("apply migration");

        let active: Vec<(String, i64)> = conn
            .prepare("SELECT id, invoke_scope_hidden FROM images ORDER BY id")
            .expect("prepare active query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query active rows")
            .collect::<Result<_, _>>()
            .expect("collect active rows");
        assert_eq!(active, vec![("invoke".into(), 1), ("other".into(), 0)]);

        let removed: i64 = conn
            .query_row(
                "SELECT invoke_scope_hidden FROM removed_images WHERE id = 'removed'",
                [],
                |row| row.get(0),
            )
            .expect("removed scope");
        assert_eq!(removed, 1);
        let facet_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM facet_cache", [], |row| row.get(0))
            .expect("facet cache count");
        assert_eq!(facet_count, 0);
        let dynamic_cache: (Option<String>, Option<i64>, Option<i64>) = conn
            .query_row(
                "SELECT dynamic_thumbnail_path, dynamic_thumbnail_cached_at, dynamic_count
                 FROM collections WHERE id = 'dynamic'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("dynamic collection cache");
        assert_eq!(dynamic_cache, (None, None, None));
        let custom_cache: Option<String> = conn
            .query_row(
                "SELECT dynamic_thumbnail_path FROM collections WHERE id = 'custom'",
                [],
                |row| row.get(0),
            )
            .expect("custom collection cache");
        assert_eq!(custom_cache.as_deref(), Some("C:/keep-cache.webp"));
    }

    #[test]
    fn creates_owner_scope_indexes_and_default_sort_plan() {
        let conn = source_schema();
        conn.execute_batch(migration65().sql)
            .expect("apply migration");

        let indexes: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = 'index' AND name LIKE '%invoke%'
                 ORDER BY name",
            )
            .expect("prepare indexes")
            .query_map([], |row| row.get(0))
            .expect("query indexes")
            .collect::<Result<_, _>>()
            .expect("collect indexes");
        assert!(indexes.contains(&"idx_images_invoke_owner_id".to_string()));
        assert!(indexes.contains(&"idx_images_invoke_scope_fast_sort_v1".to_string()));
        assert!(indexes.contains(&"idx_removed_images_invoke_scope_removed_at".to_string()));

        let plan: Vec<String> = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT id FROM images
                 WHERE invoke_scope_hidden = 0
                   AND is_deleted = 0
                   AND IFNULL(is_intermediate_gen, 0) = 0
                   AND IFNULL(is_grid_gen, 0) = 0
                   AND IFNULL(is_invoke_asset_gen, 0) = 0
                 ORDER BY timestamp DESC, id DESC",
            )
            .expect("prepare plan")
            .query_map([], |row| row.get(3))
            .expect("query plan")
            .collect::<Result<_, _>>()
            .expect("collect plan");
        assert!(
            plan.iter()
                .any(|detail| detail.contains("idx_images_invoke_scope_fast_sort_v1")),
            "expected owner scope fast-sort index, got {plan:?}"
        );
    }
}
