use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 69: Replace owner switching row rewrites with indexed logical views.
pub fn migration69() -> Migration {
    Migration {
        version: 69,
        description: "add_invoke_logical_scoped_views",
        sql: r#"
            ALTER TABLE images ADD COLUMN invoke_source_id TEXT;
            ALTER TABLE removed_images ADD COLUMN invoke_source_id TEXT;
            ALTER TABLE collections ADD COLUMN invoke_source_id TEXT;

            UPDATE images
            SET invoke_source_id = (
                SELECT db_path FROM invoke_owner_scope_state WHERE state_key = 'current'
            )
            WHERE EXISTS (
                  SELECT 1 FROM invoke_owner_scope_state s
                  WHERE s.state_key = 'current'
                    AND LOWER(REPLACE(images.path, '\', '/')) LIKE
                        LOWER(RTRIM(REPLACE(s.images_root, '\', '/'), '/') || '/outputs/images/%')
              );

            UPDATE removed_images
            SET invoke_source_id = (
                SELECT db_path FROM invoke_owner_scope_state WHERE state_key = 'current'
            )
            WHERE EXISTS (
                  SELECT 1 FROM invoke_owner_scope_state s
                  WHERE s.state_key = 'current'
                    AND LOWER(REPLACE(removed_images.path, '\', '/')) LIKE
                        LOWER(RTRIM(REPLACE(s.images_root, '\', '/'), '/') || '/outputs/images/%')
              );

            UPDATE collections
            SET invoke_source_id = (
                SELECT db_path FROM invoke_owner_scope_state WHERE state_key = 'current'
            )
            WHERE source = 'invoke'
              AND EXISTS (
                  SELECT 1 FROM invoke_owner_scope_state WHERE state_key = 'current'
              );

            -- Compatibility only. Scoped views now own visibility, but an old
            -- hidden value still identifies a previously classified Invoke row
            -- when no verified source was available during this migration.
            UPDATE images SET invoke_scope_hidden = 0
            WHERE invoke_source_id IS NOT NULL;
            UPDATE removed_images SET invoke_scope_hidden = 0
            WHERE invoke_source_id IS NOT NULL;

            CREATE INDEX idx_images_invoke_source_owner
                ON images(invoke_source_id, invoke_owner_id);
            CREATE INDEX idx_removed_images_invoke_source_owner
                ON removed_images(invoke_source_id, invoke_owner_id);
            CREATE INDEX idx_collections_invoke_source_owner
                ON collections(invoke_source_id, invoke_owner_id);

            CREATE VIEW invoke_scope_cache_visible_image_scopes AS
            SELECT i.id AS image_id, cache.scope_key
            FROM images i
            CROSS JOIN invoke_scope_cache_state cache
            WHERE (i.invoke_source_id IS NULL AND i.invoke_scope_hidden = 0)
               OR (
                    cache.db_path = i.invoke_source_id
                    AND (
                        cache.scope_mode IN ('legacy', 'all')
                        OR (cache.scope_mode = 'owner' AND cache.owner_id = i.invoke_owner_id)
                    )
               );

            CREATE VIEW invoke_scope_cache_visible_collection_scopes AS
            SELECT c.id AS collection_id, cache.scope_key
            FROM collections c
            CROSS JOIN invoke_scope_cache_state cache
            WHERE COALESCE(c.source, 'ambit') != 'invoke'
               OR (
                    cache.db_path = c.invoke_source_id
                    AND (
                        cache.scope_mode IN ('legacy', 'all')
                        OR (cache.scope_mode = 'owner' AND cache.owner_id = c.invoke_owner_id)
                    )
               );

            DROP TRIGGER IF EXISTS invoke_scope_cache_images_insert_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_images_update_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_images_delete_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_collections_insert_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_collections_update_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_collections_delete_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_membership_insert_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_membership_delete_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_loras_insert_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_loras_update_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_loras_delete_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_embeddings_insert_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_embeddings_update_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_embeddings_delete_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_hypernetworks_insert_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_hypernetworks_update_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_hypernetworks_delete_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_controlnets_insert_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_controlnets_update_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_controlnets_delete_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_ipadapters_insert_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_ipadapters_update_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_ipadapters_delete_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_models_insert_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_models_update_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_models_delete_dirty;

            CREATE TRIGGER invoke_scope_cache_images_insert_dirty
            AFTER INSERT ON images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND scope_key IN (
                      SELECT scope_key FROM invoke_scope_cache_visible_image_scopes
                      WHERE image_id = NEW.id
                  );
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
                invoke_image_category, invoke_image_origin, invoke_owner_id,
                invoke_source_id
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

            CREATE TRIGGER invoke_scope_cache_images_delete_dirty
            AFTER DELETE ON images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (
                      (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                      OR (
                          db_path = OLD.invoke_source_id
                          AND (
                              scope_mode IN ('legacy', 'all')
                              OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                          )
                      )
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_collections_insert_dirty
            AFTER INSERT ON collections
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND scope_key IN (
                      SELECT scope_key FROM invoke_scope_cache_visible_collection_scopes
                      WHERE collection_id = NEW.id
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_collections_update_dirty
            AFTER UPDATE OF filter_state, manual_exclusions, source, invoke_owner_id,
                            invoke_source_id ON collections
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (
                      scope_key IN (
                          SELECT scope_key FROM invoke_scope_cache_visible_collection_scopes
                          WHERE collection_id = NEW.id
                      )
                      OR COALESCE(OLD.source, 'ambit') != 'invoke'
                      OR (
                          db_path = OLD.invoke_source_id
                          AND (
                              scope_mode IN ('legacy', 'all')
                              OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                          )
                      )
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_collections_delete_dirty
            AFTER DELETE ON collections
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (
                      COALESCE(OLD.source, 'ambit') != 'invoke'
                      OR (
                          db_path = OLD.invoke_source_id
                          AND (
                              scope_mode IN ('legacy', 'all')
                              OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                          )
                      )
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_membership_insert_dirty
            AFTER INSERT ON collection_images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND scope_key IN (
                      SELECT scope_key FROM invoke_scope_cache_visible_image_scopes
                      WHERE image_id = NEW.image_id
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_membership_delete_dirty
            AFTER DELETE ON collection_images
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
                          WHERE image_id = OLD.image_id
                      )
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_loras_insert_dirty AFTER INSERT ON image_loras BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = NEW.image_id);
            END;
            CREATE TRIGGER invoke_scope_cache_loras_update_dirty AFTER UPDATE ON image_loras BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id IN (OLD.image_id, NEW.image_id));
            END;
            CREATE TRIGGER invoke_scope_cache_loras_delete_dirty AFTER DELETE ON image_loras BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = OLD.image_id);
            END;

            CREATE TRIGGER invoke_scope_cache_embeddings_insert_dirty AFTER INSERT ON image_embeddings BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = NEW.image_id);
            END;
            CREATE TRIGGER invoke_scope_cache_embeddings_update_dirty AFTER UPDATE ON image_embeddings BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id IN (OLD.image_id, NEW.image_id));
            END;
            CREATE TRIGGER invoke_scope_cache_embeddings_delete_dirty AFTER DELETE ON image_embeddings BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = OLD.image_id);
            END;

            CREATE TRIGGER invoke_scope_cache_hypernetworks_insert_dirty AFTER INSERT ON image_hypernetworks BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = NEW.image_id);
            END;
            CREATE TRIGGER invoke_scope_cache_hypernetworks_update_dirty AFTER UPDATE ON image_hypernetworks BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id IN (OLD.image_id, NEW.image_id));
            END;
            CREATE TRIGGER invoke_scope_cache_hypernetworks_delete_dirty AFTER DELETE ON image_hypernetworks BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = OLD.image_id);
            END;

            CREATE TRIGGER invoke_scope_cache_controlnets_insert_dirty AFTER INSERT ON image_controlnets BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = NEW.image_id);
            END;
            CREATE TRIGGER invoke_scope_cache_controlnets_update_dirty AFTER UPDATE ON image_controlnets BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id IN (OLD.image_id, NEW.image_id));
            END;
            CREATE TRIGGER invoke_scope_cache_controlnets_delete_dirty AFTER DELETE ON image_controlnets BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = OLD.image_id);
            END;

            CREATE TRIGGER invoke_scope_cache_ipadapters_insert_dirty AFTER INSERT ON image_ipadapters BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = NEW.image_id);
            END;
            CREATE TRIGGER invoke_scope_cache_ipadapters_update_dirty AFTER UPDATE ON image_ipadapters BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id IN (OLD.image_id, NEW.image_id));
            END;
            CREATE TRIGGER invoke_scope_cache_ipadapters_delete_dirty AFTER DELETE ON image_ipadapters BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = OLD.image_id);
            END;

            -- Model inventory is shared by every logical owner scope, so model
            -- mutations invalidate every prepared scope.
            CREATE TRIGGER invoke_scope_cache_models_insert_dirty AFTER INSERT ON models BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_models_update_dirty AFTER UPDATE ON models BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_models_delete_dirty AFTER DELETE ON models BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;

            CREATE VIEW scoped_images AS
            SELECT i.rowid AS rowid, i.*
            FROM images i
            LEFT JOIN invoke_owner_scope_state s ON s.state_key = 'current'
            WHERE (i.invoke_source_id IS NULL AND i.invoke_scope_hidden = 0)
               OR (
                    i.invoke_source_id = s.db_path
                    AND (
                        s.scope_mode IN ('legacy', 'all')
                        OR (s.scope_mode = 'owner' AND i.invoke_owner_id = s.owner_id)
                    )
               );

            CREATE VIEW scoped_removed_images AS
            SELECT i.rowid AS rowid, i.*
            FROM removed_images i
            LEFT JOIN invoke_owner_scope_state s ON s.state_key = 'current'
            WHERE (i.invoke_source_id IS NULL AND i.invoke_scope_hidden = 0)
               OR (
                    i.invoke_source_id = s.db_path
                    AND (
                        s.scope_mode IN ('legacy', 'all')
                        OR (s.scope_mode = 'owner' AND i.invoke_owner_id = s.owner_id)
                    )
               );

            CREATE VIEW scoped_collections AS
            SELECT c.rowid AS rowid, c.*
            FROM collections c
            LEFT JOIN invoke_owner_scope_state s ON s.state_key = 'current'
            WHERE COALESCE(c.source, 'ambit') != 'invoke'
               OR (
                    c.source = 'invoke'
                    AND c.invoke_source_id = s.db_path
                    AND (
                        s.scope_mode IN ('legacy', 'all')
                        OR (s.scope_mode = 'owner' AND c.invoke_owner_id = s.owner_id)
                    )
               );

            CREATE TRIGGER images_assign_invoke_source_after_insert
            AFTER INSERT ON images
            WHEN EXISTS (
                 SELECT 1 FROM invoke_owner_scope_state s
                 WHERE s.state_key = 'current'
                   AND LOWER(REPLACE(NEW.path, '\', '/')) LIKE
                       LOWER(RTRIM(REPLACE(s.images_root, '\', '/'), '/') || '/outputs/images/%')
             )
            BEGIN
                UPDATE images
                SET invoke_source_id = COALESCE(NEW.invoke_source_id, (
                        SELECT db_path FROM invoke_owner_scope_state WHERE state_key = 'current'
                    )),
                    invoke_scope_hidden = 0
                WHERE id = NEW.id;
            END;

            CREATE TRIGGER images_assign_invoke_source_after_update
            AFTER UPDATE OF path, invoke_image_name ON images
            WHEN EXISTS (
                 SELECT 1 FROM invoke_owner_scope_state s
                 WHERE s.state_key = 'current'
                   AND LOWER(REPLACE(NEW.path, '\', '/')) LIKE
                       LOWER(RTRIM(REPLACE(s.images_root, '\', '/'), '/') || '/outputs/images/%')
             )
            BEGIN
                UPDATE images
                SET invoke_source_id = COALESCE(NEW.invoke_source_id, (
                        SELECT db_path FROM invoke_owner_scope_state WHERE state_key = 'current'
                    )),
                    invoke_scope_hidden = 0
                WHERE id = NEW.id;
            END;

            CREATE TRIGGER removed_images_assign_invoke_source_after_insert
            AFTER INSERT ON removed_images
            WHEN EXISTS (
                 SELECT 1 FROM invoke_owner_scope_state s
                 WHERE s.state_key = 'current'
                   AND LOWER(REPLACE(NEW.path, '\', '/')) LIKE
                       LOWER(RTRIM(REPLACE(s.images_root, '\', '/'), '/') || '/outputs/images/%')
             )
            BEGIN
                UPDATE removed_images
                SET invoke_source_id = COALESCE(NEW.invoke_source_id, (
                        SELECT db_path FROM invoke_owner_scope_state WHERE state_key = 'current'
                    )),
                    invoke_scope_hidden = 0
                WHERE id = NEW.id;
            END;

            CREATE TRIGGER collections_assign_invoke_source_after_insert
            AFTER INSERT ON collections
            WHEN NEW.source = 'invoke' AND NEW.invoke_source_id IS NULL
            BEGIN
                UPDATE collections
                SET invoke_source_id = (
                    SELECT db_path FROM invoke_owner_scope_state WHERE state_key = 'current'
                )
                WHERE id = NEW.id;
            END;

            CREATE TRIGGER collections_assign_invoke_source_after_update
            AFTER UPDATE OF source, invoke_owner_id ON collections
            WHEN NEW.source = 'invoke' AND NEW.invoke_source_id IS NULL
            BEGIN
                UPDATE collections
                SET invoke_source_id = (
                    SELECT db_path FROM invoke_owner_scope_state WHERE state_key = 'current'
                )
                WHERE id = NEW.id;
            END;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration69;
    use rusqlite::Connection;

    fn source_schema() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY, path TEXT NOT NULL, invoke_image_name TEXT,
                invoke_owner_id TEXT, invoke_scope_hidden INTEGER NOT NULL DEFAULT 0,
                is_deleted INTEGER NOT NULL DEFAULT 0, is_intermediate_gen INTEGER,
                is_grid_gen INTEGER, is_invoke_asset_gen INTEGER, timestamp INTEGER
            );
            CREATE INDEX idx_images_invoke_scope_fast_sort_v1
                ON images(
                    invoke_scope_hidden, is_deleted,
                    IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0),
                    IFNULL(is_invoke_asset_gen, 0), timestamp DESC, id DESC
                );
            CREATE TABLE removed_images (
                id TEXT PRIMARY KEY, path TEXT NOT NULL, invoke_image_name TEXT,
                invoke_owner_id TEXT, invoke_scope_hidden INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE collections (
                id TEXT PRIMARY KEY, source TEXT, invoke_owner_id TEXT
            );
            CREATE TABLE invoke_owner_scope_state (
                state_key TEXT PRIMARY KEY, db_path TEXT NOT NULL, images_root TEXT NOT NULL,
                scope_mode TEXT NOT NULL, owner_id TEXT, updated_at INTEGER NOT NULL
            );
            INSERT INTO invoke_owner_scope_state VALUES
                ('current', 'D:/Invoke/databases/invokeai.db', 'D:/Invoke', 'owner', 'a', 1);
            CREATE TABLE invoke_scope_cache_state (
                scope_key TEXT PRIMARY KEY, db_path TEXT NOT NULL, images_root TEXT NOT NULL,
                scope_mode TEXT NOT NULL, owner_id TEXT, status TEXT NOT NULL,
                generation INTEGER NOT NULL, built_generation INTEGER, updated_at INTEGER NOT NULL
            );
            INSERT INTO invoke_scope_cache_state VALUES
                ('owner-a', 'D:/Invoke/databases/invokeai.db', 'D:/Invoke', 'owner', 'a', 'ready', 0, 0, 1),
                ('owner-b', 'D:/Invoke/databases/invokeai.db', 'D:/Invoke', 'owner', 'b', 'ready', 0, 0, 1),
                ('all', 'D:/Invoke/databases/invokeai.db', 'D:/Invoke', 'all', NULL, 'ready', 0, 0, 1);
            CREATE TABLE invoke_scope_cache_control (
                state_key TEXT PRIMARY KEY, active_scope_key TEXT NOT NULL,
                suppress_invalidation INTEGER NOT NULL
            );
            INSERT INTO invoke_scope_cache_control VALUES ('current', 'owner-a', 0);
            CREATE TABLE collection_images (collection_id TEXT, image_id TEXT);
            CREATE TABLE image_loras (image_id TEXT, lora_name TEXT);
            CREATE TABLE image_embeddings (image_id TEXT, embedding_name TEXT);
            CREATE TABLE image_hypernetworks (image_id TEXT, hypernetwork_name TEXT);
            CREATE TABLE image_controlnets (image_id TEXT, model_name TEXT);
            CREATE TABLE image_ipadapters (image_id TEXT, model_name TEXT);
            CREATE TABLE models (name TEXT PRIMARY KEY);
            INSERT INTO images (
                id, path, invoke_image_name, invoke_owner_id, invoke_scope_hidden, timestamp
            ) VALUES
                ('local', 'D:/Pictures/local.png', NULL, NULL, 0, 1),
                ('copied', 'D:/Pictures/copied-invoke.png', 'copied.png', 'a', 0, 2),
                ('a', 'D:/Invoke/outputs/images/a.png', 'a.png', 'a', 1, 3),
                ('b', 'D:/Invoke/outputs/images/b.png', 'b.png', 'b', 1, 4),
                ('unknown', 'D:/Invoke/outputs/images/unknown.png', NULL, NULL, 0, 5);
            INSERT INTO removed_images VALUES
                ('removed-a', 'D:/Invoke/outputs/images/removed-a.png', 'removed-a.png', 'a', 1),
                ('removed-b', 'D:/Invoke/outputs/images/removed-b.png', 'removed-b.png', 'b', 1);
            INSERT INTO collections VALUES
                ('local-board', 'ambit', NULL),
                ('board-a', 'invoke', 'a'),
                ('board-b', 'invoke', 'b');
            ",
        )
        .expect("source schema");
        conn
    }

    fn ids(conn: &Connection, view: &str) -> Vec<String> {
        conn.prepare(&format!("SELECT id FROM {view} ORDER BY id"))
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn views_fail_closed_and_switch_without_rewriting_rows() {
        let conn = source_schema();
        conn.execute_batch(migration69().sql)
            .expect("apply migration");

        assert_eq!(ids(&conn, "scoped_images"), vec!["a", "copied", "local"]);
        let visible_rowids: Vec<i64> = conn
            .prepare("SELECT rowid FROM scoped_images ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(visible_rowids.len(), 3);
        assert!(visible_rowids.iter().all(|rowid| *rowid > 0));
        assert_eq!(ids(&conn, "scoped_removed_images"), vec!["removed-a"]);
        assert_eq!(
            ids(&conn, "scoped_collections"),
            vec!["board-a", "local-board"]
        );

        conn.execute(
            "UPDATE invoke_owner_scope_state
             SET scope_mode = 'owner', owner_id = 'b' WHERE state_key = 'current'",
            [],
        )
        .unwrap();
        assert_eq!(ids(&conn, "scoped_images"), vec!["b", "copied", "local"]);
        assert_eq!(
            ids(&conn, "scoped_collections"),
            vec!["board-b", "local-board"]
        );

        conn.execute(
            "UPDATE invoke_owner_scope_state
             SET scope_mode = 'all', owner_id = NULL WHERE state_key = 'current'",
            [],
        )
        .unwrap();
        assert_eq!(
            ids(&conn, "scoped_images"),
            vec!["a", "b", "copied", "local", "unknown"]
        );
        let hidden_sum: i64 = conn
            .query_row("SELECT SUM(invoke_scope_hidden) FROM images", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(hidden_sum, 0, "scope switches must not rewrite image rows");
    }

    #[test]
    fn scoped_image_view_preserves_the_large_library_fast_sort_plan() {
        let conn = source_schema();
        conn.execute_batch(migration69().sql)
            .expect("apply migration");

        let plan: Vec<String> = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT id FROM scoped_images
                 WHERE invoke_scope_hidden = 0
                   AND is_deleted = 0
                   AND IFNULL(is_intermediate_gen, 0) = 0
                   AND IFNULL(is_grid_gen, 0) = 0
                   AND IFNULL(is_invoke_asset_gen, 0) = 0
                 ORDER BY timestamp DESC, id DESC
                 LIMIT 200",
            )
            .unwrap()
            .query_map([], |row| row.get(3))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(
            plan.iter()
                .any(|detail| detail.contains("idx_images_invoke_scope_fast_sort_v1")),
            "scoped reads must retain the existing fast-sort index: {plan:?}"
        );
        assert!(
            plan.iter()
                .all(|detail| !detail.contains("USE TEMP B-TREE")),
            "the first gallery page must not sort the complete scoped library: {plan:?}"
        );
    }

    #[test]
    fn legacy_owner_rows_remain_fail_closed_without_a_verified_source() {
        let conn = source_schema();
        conn.execute("DELETE FROM invoke_owner_scope_state", [])
            .expect("remove verified source");
        conn.execute_batch(migration69().sql)
            .expect("apply migration");

        assert_eq!(
            ids(&conn, "scoped_images"),
            vec!["copied", "local", "unknown"]
        );
        assert!(ids(&conn, "scoped_removed_images").is_empty());
        assert_eq!(ids(&conn, "scoped_collections"), vec!["local-board"]);
    }

    #[test]
    fn invoke_mutations_dirty_only_matching_owner_and_aggregate_scopes() {
        let conn = source_schema();
        conn.execute_batch(migration69().sql)
            .expect("apply migration");

        conn.execute(
            "INSERT INTO images (
                id, path, invoke_image_name, invoke_owner_id, invoke_scope_hidden,
                invoke_source_id
             ) VALUES ('a-new', 'D:/Invoke/outputs/images/a-new.png', 'a-new.png', 'a', 0,
                       'D:/Invoke/databases/invokeai.db')",
            [],
        )
        .unwrap();
        let states = || -> Vec<(String, String)> {
            conn.prepare(
                "SELECT scope_key, status FROM invoke_scope_cache_state ORDER BY scope_key",
            )
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
        };
        assert_eq!(
            states(),
            vec![
                ("all".into(), "dirty".into()),
                ("owner-a".into(), "dirty".into()),
                ("owner-b".into(), "ready".into()),
            ]
        );

        conn.execute(
            "UPDATE invoke_scope_cache_state
             SET status = 'ready', built_generation = generation",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('b', 'Detailer')",
            [],
        )
        .unwrap();
        assert_eq!(
            states(),
            vec![
                ("all".into(), "dirty".into()),
                ("owner-a".into(), "ready".into()),
                ("owner-b".into(), "dirty".into()),
            ]
        );

        conn.execute(
            "UPDATE invoke_scope_cache_state
             SET status = 'ready', built_generation = generation",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO images (id, path, invoke_scope_hidden)
             VALUES ('local-new', 'D:/Pictures/local-new.png', 0)",
            [],
        )
        .unwrap();
        assert!(states().iter().all(|(_, status)| status == "dirty"));

        conn.execute(
            "UPDATE invoke_scope_cache_state
             SET status = 'ready', built_generation = generation",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM images WHERE id = 'copied'", [])
            .unwrap();
        assert!(
            states().iter().all(|(_, status)| status == "dirty"),
            "deleting a locally scanned Invoke copy must invalidate every scope"
        );

        conn.execute(
            "UPDATE invoke_scope_cache_state
             SET status = 'ready', built_generation = generation",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO models (name) VALUES ('shared-model')", [])
            .unwrap();
        assert!(
            states().iter().all(|(_, status)| status == "dirty"),
            "shared model mutations must invalidate every owner scope"
        );

        conn.execute(
            "UPDATE invoke_scope_cache_state
             SET status = 'ready', built_generation = generation",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM images WHERE id = 'b'", [])
            .unwrap();
        conn.execute(
            "UPDATE invoke_scope_cache_state
             SET status = 'ready', built_generation = generation",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM image_loras WHERE image_id = 'b'", [])
            .unwrap();
        assert!(
            states().iter().all(|(_, status)| status == "ready"),
            "removing a junction row after its image disappeared must not dirty unrelated scopes"
        );
    }
}
