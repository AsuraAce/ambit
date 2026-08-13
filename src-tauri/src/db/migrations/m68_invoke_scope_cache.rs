use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 68: Persist owner-scoped derived data while retaining the existing
/// facet and collection columns as the active compatibility projection.
pub fn migration68() -> Migration {
    Migration {
        version: 68,
        description: "add_invoke_scope_derived_cache",
        sql: r#"
            CREATE TABLE invoke_scope_cache_state (
                scope_key TEXT PRIMARY KEY,
                db_path TEXT NOT NULL,
                images_root TEXT NOT NULL,
                scope_mode TEXT NOT NULL
                    CHECK (scope_mode IN ('legacy', 'unselected', 'owner', 'all')),
                owner_id TEXT,
                status TEXT NOT NULL
                    CHECK (status IN ('missing', 'dirty', 'building', 'ready')),
                generation INTEGER NOT NULL DEFAULT 0,
                built_generation INTEGER,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE invoke_scope_cache_control (
                state_key TEXT PRIMARY KEY CHECK (state_key = 'current'),
                active_scope_key TEXT,
                suppress_invalidation INTEGER NOT NULL DEFAULT 0
                    CHECK (suppress_invalidation IN (0, 1)),
                FOREIGN KEY (active_scope_key)
                    REFERENCES invoke_scope_cache_state(scope_key) ON DELETE SET NULL
            );

            INSERT INTO invoke_scope_cache_control (
                state_key, active_scope_key, suppress_invalidation
            ) VALUES ('current', NULL, 0);

            CREATE TABLE invoke_scope_facet_cache (
                scope_key TEXT NOT NULL,
                facet_type TEXT NOT NULL,
                resource_name TEXT NOT NULL,
                resource_hash TEXT,
                count INTEGER DEFAULT 0,
                thumbnail_path TEXT,
                preview_url TEXT,
                last_used_at INTEGER,
                created_at INTEGER,
                is_manual INTEGER DEFAULT 0,
                has_sidecar INTEGER DEFAULT 0,
                is_user_override INTEGER DEFAULT 0,
                guidance_subtype TEXT,
                safe_thumbnail_path TEXT,
                thumbnail_image_id TEXT,
                thumbnail_is_sensitive INTEGER DEFAULT 0,
                thumbnail_sensitivity_override INTEGER,
                PRIMARY KEY (scope_key, facet_type, resource_name),
                FOREIGN KEY (scope_key)
                    REFERENCES invoke_scope_cache_state(scope_key) ON DELETE CASCADE
            ) WITHOUT ROWID;

            CREATE INDEX idx_invoke_scope_facet_cache_type
                ON invoke_scope_facet_cache(scope_key, facet_type);

            CREATE TABLE invoke_scope_collection_cache (
                scope_key TEXT NOT NULL,
                collection_id TEXT NOT NULL,
                dynamic_thumbnail_path TEXT,
                dynamic_safe_thumbnail_path TEXT,
                dynamic_thumbnail_is_sensitive INTEGER,
                dynamic_thumbnail_cached_at INTEGER,
                dynamic_count INTEGER,
                PRIMARY KEY (scope_key, collection_id),
                FOREIGN KEY (scope_key)
                    REFERENCES invoke_scope_cache_state(scope_key) ON DELETE CASCADE
            ) WITHOUT ROWID;

            -- Preserve the already prepared current view across upgrade. The unit
            -- separator keeps the identity reversible without depending on hashing.
            INSERT INTO invoke_scope_cache_state (
                scope_key, db_path, images_root, scope_mode, owner_id,
                status, generation, built_generation, updated_at
            )
            SELECT db_path || char(31) || scope_mode || char(31) || COALESCE(owner_id, ''),
                   db_path, images_root, scope_mode, owner_id,
                   'ready', 0, 0, updated_at
            FROM invoke_owner_scope_state
            WHERE state_key = 'current';

            INSERT INTO invoke_scope_facet_cache (
                scope_key, facet_type, resource_name, resource_hash, count,
                thumbnail_path, preview_url, last_used_at, created_at, is_manual,
                has_sidecar, is_user_override, guidance_subtype,
                safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive,
                thumbnail_sensitivity_override
            )
            SELECT s.scope_key, f.facet_type, f.resource_name, f.resource_hash, f.count,
                   f.thumbnail_path, f.preview_url, f.last_used_at, f.created_at, f.is_manual,
                   f.has_sidecar, f.is_user_override, f.guidance_subtype,
                   f.safe_thumbnail_path, f.thumbnail_image_id, f.thumbnail_is_sensitive,
                   f.thumbnail_sensitivity_override
            FROM facet_cache f
            CROSS JOIN invoke_scope_cache_state s;

            INSERT INTO invoke_scope_collection_cache (
                scope_key, collection_id, dynamic_thumbnail_path,
                dynamic_safe_thumbnail_path, dynamic_thumbnail_is_sensitive,
                dynamic_thumbnail_cached_at, dynamic_count
            )
            SELECT s.scope_key, c.id, c.dynamic_thumbnail_path,
                   c.dynamic_safe_thumbnail_path, c.dynamic_thumbnail_is_sensitive,
                   c.dynamic_thumbnail_cached_at, c.dynamic_count
            FROM collections c
            CROSS JOIN invoke_scope_cache_state s;

            UPDATE invoke_scope_cache_control
            SET active_scope_key = (
                SELECT scope_key FROM invoke_scope_cache_state LIMIT 1
            )
            WHERE state_key = 'current';

            -- Real library mutations invalidate every stored scope. Owner switching
            -- and cache projection run with suppress_invalidation=1, so visibility-
            -- only writes never dirty the snapshots.
            CREATE TRIGGER invoke_scope_cache_images_insert_dirty
            AFTER INSERT ON images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty';
            END;

            CREATE TRIGGER invoke_scope_cache_images_update_dirty
            AFTER UPDATE OF
                id, path, width, height, file_size, timestamp, metadata_json,
                thumbnail_path, is_favorite, is_pinned, is_deleted, is_missing,
                user_masked, group_id, notes, original_metadata_json, board_id,
                model_hash, model_name, tool, resolved_model_name, steps, cfg,
                sampler, generation_type, original_state_json, thumbnail_source,
                micro_thumbnail, positive_prompt, negative_prompt, is_corrupt,
                parser_version, original_parsed_json, privacy_hidden, file_hash,
                thumbnail_version, thumbnail_failure_count, thumbnail_last_error,
                thumbnail_last_attempt_at, seed, invoke_image_name,
                invoke_image_category, invoke_image_origin, invoke_owner_id
            ON images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty';
            END;

            CREATE TRIGGER invoke_scope_cache_images_delete_dirty
            AFTER DELETE ON images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty';
            END;

            CREATE TRIGGER invoke_scope_cache_collections_insert_dirty
            AFTER INSERT ON collections
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty';
            END;

            CREATE TRIGGER invoke_scope_cache_collections_update_dirty
            AFTER UPDATE OF filter_state, manual_exclusions, source, invoke_owner_id ON collections
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty';
            END;

            CREATE TRIGGER invoke_scope_cache_collections_delete_dirty
            AFTER DELETE ON collections
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty';
            END;

            CREATE TRIGGER invoke_scope_cache_membership_insert_dirty
            AFTER INSERT ON collection_images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty';
            END;

            CREATE TRIGGER invoke_scope_cache_membership_delete_dirty
            AFTER DELETE ON collection_images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty';
            END;

            CREATE TRIGGER invoke_scope_cache_loras_insert_dirty AFTER INSERT ON image_loras BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_loras_delete_dirty AFTER DELETE ON image_loras BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_loras_update_dirty AFTER UPDATE ON image_loras BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_embeddings_insert_dirty AFTER INSERT ON image_embeddings BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_embeddings_delete_dirty AFTER DELETE ON image_embeddings BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_embeddings_update_dirty AFTER UPDATE ON image_embeddings BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_hypernetworks_insert_dirty AFTER INSERT ON image_hypernetworks BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_hypernetworks_delete_dirty AFTER DELETE ON image_hypernetworks BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_hypernetworks_update_dirty AFTER UPDATE ON image_hypernetworks BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_controlnets_insert_dirty AFTER INSERT ON image_controlnets BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_controlnets_delete_dirty AFTER DELETE ON image_controlnets BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_controlnets_update_dirty AFTER UPDATE ON image_controlnets BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_ipadapters_insert_dirty AFTER INSERT ON image_ipadapters BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_ipadapters_delete_dirty AFTER DELETE ON image_ipadapters BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_ipadapters_update_dirty AFTER UPDATE ON image_ipadapters BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;

            CREATE TRIGGER invoke_scope_cache_models_insert_dirty AFTER INSERT ON models BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_models_update_dirty AFTER UPDATE ON models BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_models_delete_dirty AFTER DELETE ON models BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1
                WHERE status != 'dirty' AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration68;
    use rusqlite::Connection;

    fn source_schema() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE images (id TEXT PRIMARY KEY, invoke_scope_hidden INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE collections (
                id TEXT PRIMARY KEY, filter_state TEXT, manual_exclusions TEXT,
                source TEXT, invoke_owner_id TEXT, dynamic_thumbnail_path TEXT,
                dynamic_safe_thumbnail_path TEXT, dynamic_thumbnail_is_sensitive INTEGER,
                dynamic_thumbnail_cached_at INTEGER, dynamic_count INTEGER
            );
            CREATE TABLE collection_images (collection_id TEXT, image_id TEXT);
            CREATE TABLE image_loras (image_id TEXT, lora_name TEXT);
            CREATE TABLE image_embeddings (image_id TEXT, embedding_name TEXT);
            CREATE TABLE image_hypernetworks (image_id TEXT, hypernetwork_name TEXT);
            CREATE TABLE image_controlnets (image_id TEXT, controlnet_name TEXT);
            CREATE TABLE image_ipadapters (image_id TEXT, ipadapter_name TEXT);
            CREATE TABLE models (hash TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE facet_cache (
                facet_type TEXT NOT NULL, resource_name TEXT NOT NULL,
                resource_hash TEXT, count INTEGER DEFAULT 0, thumbnail_path TEXT,
                preview_url TEXT, last_used_at INTEGER, created_at INTEGER,
                is_manual INTEGER DEFAULT 0, has_sidecar INTEGER DEFAULT 0,
                is_user_override INTEGER DEFAULT 0, guidance_subtype TEXT,
                safe_thumbnail_path TEXT, thumbnail_image_id TEXT,
                thumbnail_is_sensitive INTEGER DEFAULT 0,
                thumbnail_sensitivity_override INTEGER
            );
            CREATE TABLE invoke_owner_scope_state (
                state_key TEXT PRIMARY KEY, db_path TEXT NOT NULL, images_root TEXT NOT NULL,
                scope_mode TEXT NOT NULL, owner_id TEXT, updated_at INTEGER NOT NULL
            );
            ",
        )
        .expect("source schema");
        conn
    }

    #[test]
    fn preserves_current_derived_cache_as_ready_scope() {
        let conn = source_schema();
        conn.execute_batch(
            "
            INSERT INTO invoke_owner_scope_state VALUES
                ('current', 'D:/invoke/invokeai.db', 'D:/invoke', 'owner', 'system', 10);
            INSERT INTO facet_cache (facet_type, resource_name, count)
                VALUES ('tools', 'InvokeAI', 42);
            INSERT INTO collections (id, source, invoke_owner_id, dynamic_thumbnail_path, dynamic_count)
                VALUES ('board', 'invoke', 'system', 'thumb.webp', 7);
            ",
        )
        .expect("seed cache");

        conn.execute_batch(migration68().sql)
            .expect("apply migration");

        let state: (String, i64, Option<i64>) = conn
            .query_row(
                "SELECT status, generation, built_generation FROM invoke_scope_cache_state",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("scope state");
        assert_eq!(state, ("ready".into(), 0, Some(0)));
        assert_eq!(
            conn.query_row("SELECT count FROM invoke_scope_facet_cache", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            42
        );
        assert_eq!(
            conn.query_row(
                "SELECT dynamic_count FROM invoke_scope_collection_cache",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            7
        );
    }

    #[test]
    fn real_mutations_dirty_once_but_suppressed_visibility_updates_do_not() {
        let conn = source_schema();
        conn.execute_batch(
            "
            INSERT INTO invoke_owner_scope_state VALUES
                ('current', 'db', 'root', 'owner', 'system', 10);
            INSERT INTO images VALUES ('existing', 0);
            ",
        )
        .expect("seed scope");
        conn.execute_batch(migration68().sql)
            .expect("apply migration");

        conn.execute("INSERT INTO images VALUES ('new', 0)", [])
            .unwrap();
        conn.execute("INSERT INTO images VALUES ('newer', 0)", [])
            .unwrap();
        let dirty: (String, i64) = conn
            .query_row(
                "SELECT status, generation FROM invoke_scope_cache_state",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(dirty, ("dirty".into(), 1));

        conn.execute_batch(
            "
            UPDATE invoke_scope_cache_state
            SET status = 'ready', built_generation = generation;
            UPDATE invoke_scope_cache_control SET suppress_invalidation = 1;
            UPDATE images SET invoke_scope_hidden = 1;
            UPDATE invoke_scope_cache_control SET suppress_invalidation = 0;
            ",
        )
        .unwrap();
        let ready: (String, i64, i64) = conn
            .query_row(
                "SELECT status, generation, built_generation FROM invoke_scope_cache_state",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(ready, ("ready".into(), 1, 1));
    }
}
