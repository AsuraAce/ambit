use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 70: Persist the reason an Invoke owner-scope cache became dirty so
/// activation can repair only the affected resources or collection projection.
pub fn migration70() -> Migration {
    Migration {
        version: 70,
        description: "add_invoke_scope_selective_dirty_items",
        sql: r#"
            CREATE TABLE invoke_scope_cache_dirty_items (
                scope_key TEXT NOT NULL,
                domain TEXT NOT NULL
                    CHECK (domain IN ('facet_resource', 'facet_type', 'collections', 'full')),
                facet_type TEXT NOT NULL DEFAULT '',
                resource_name TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (scope_key, domain, facet_type, resource_name),
                FOREIGN KEY (scope_key)
                    REFERENCES invoke_scope_cache_state(scope_key) ON DELETE CASCADE
            ) WITHOUT ROWID;

            ALTER TABLE invoke_scope_cache_control
                ADD COLUMN suppress_active_model_invalidation INTEGER NOT NULL DEFAULT 0;

            -- Model harvesting and exact resource repair can add rows to the shared
            -- model inventory while building the active projection. Suppress only
            -- that active build during the narrowly-scoped internal write window.
            -- Unrelated model writes must still invalidate a build in progress.
            DROP TRIGGER IF EXISTS invoke_scope_cache_models_insert_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_models_update_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_models_delete_dirty;

            CREATE TRIGGER invoke_scope_cache_models_insert_dirty AFTER INSERT ON models BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND NOT (
                      status = 'building'
                      AND scope_key = (SELECT active_scope_key FROM invoke_scope_cache_control WHERE state_key = 'current')
                      AND (SELECT suppress_active_model_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 1
                  )
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_models_update_dirty AFTER UPDATE ON models BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND NOT (
                      status = 'building'
                      AND scope_key = (SELECT active_scope_key FROM invoke_scope_cache_control WHERE state_key = 'current')
                      AND (SELECT suppress_active_model_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 1
                  )
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_models_delete_dirty AFTER DELETE ON models BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND NOT (
                      status = 'building'
                      AND scope_key = (SELECT active_scope_key FROM invoke_scope_cache_control WHERE state_key = 'current')
                      AND (SELECT suppress_active_model_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 1
                  )
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;

            -- A process can stop after beginning a build. Existing dirty rows also
            -- predate this ledger, so their cause is unknown and must be repaired once.
            UPDATE invoke_scope_cache_state
            SET status = 'dirty', generation = generation + 1,
                updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
            WHERE status = 'building'
               OR (status = 'ready' AND built_generation IS NOT generation);

            INSERT OR IGNORE INTO invoke_scope_cache_dirty_items (
                scope_key, domain, facet_type, resource_name
            )
            SELECT scope_key, 'full', '', ''
            FROM invoke_scope_cache_state
            WHERE status IN ('dirty', 'building');

            CREATE TRIGGER invoke_scope_cache_images_insert_detail
            AFTER INSERT ON images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'facet_resource', 'checkpoints',
                       COALESCE(NULLIF(TRIM(NEW.resolved_model_name), ''),
                                NULLIF(TRIM(NEW.model_name), ''), 'Unknown')
                FROM invoke_scope_cache_state
                WHERE (NEW.invoke_source_id IS NULL AND NEW.invoke_scope_hidden = 0)
                   OR (db_path = NEW.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = NEW.invoke_owner_id)
                   ));

                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'facet_resource', 'tools',
                       COALESCE(NULLIF(TRIM(NEW.tool), ''), 'Unknown')
                FROM invoke_scope_cache_state
                WHERE (NEW.invoke_source_id IS NULL AND NEW.invoke_scope_hidden = 0)
                   OR (db_path = NEW.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = NEW.invoke_owner_id)
                   ));

                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'collections', '', ''
                FROM invoke_scope_cache_state
                WHERE (NEW.invoke_source_id IS NULL AND NEW.invoke_scope_hidden = 0)
                   OR (db_path = NEW.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = NEW.invoke_owner_id)
                   ));
            END;

            CREATE TRIGGER invoke_scope_cache_images_update_detail
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
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'full', '', ''
                FROM invoke_scope_cache_state
                WHERE (OLD.id IS NOT NEW.id
                       OR OLD.invoke_owner_id IS NOT NEW.invoke_owner_id
                       OR OLD.invoke_source_id IS NOT NEW.invoke_source_id)
                  AND (
                       (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                       OR (db_path = OLD.invoke_source_id AND (
                            scope_mode IN ('legacy', 'all')
                            OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                       ))
                       OR (NEW.invoke_source_id IS NULL AND NEW.invoke_scope_hidden = 0)
                       OR (db_path = NEW.invoke_source_id AND (
                            scope_mode IN ('legacy', 'all')
                            OR (scope_mode = 'owner' AND owner_id = NEW.invoke_owner_id)
                       ))
                  );

                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'facet_resource', 'checkpoints', resource_name
                FROM invoke_scope_cache_state
                CROSS JOIN (
                    SELECT COALESCE(NULLIF(TRIM(OLD.resolved_model_name), ''),
                                    NULLIF(TRIM(OLD.model_name), ''), 'Unknown') AS resource_name
                    UNION
                    SELECT COALESCE(NULLIF(TRIM(NEW.resolved_model_name), ''),
                                    NULLIF(TRIM(NEW.model_name), ''), 'Unknown')
                ) resources
                WHERE (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                   OR (db_path = OLD.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                   ))
                   OR (NEW.invoke_source_id IS NULL AND NEW.invoke_scope_hidden = 0)
                   OR (db_path = NEW.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = NEW.invoke_owner_id)
                   ));

                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'facet_resource', 'tools', resource_name
                FROM invoke_scope_cache_state
                CROSS JOIN (
                    SELECT COALESCE(NULLIF(TRIM(OLD.tool), ''), 'Unknown') AS resource_name
                    UNION
                    SELECT COALESCE(NULLIF(TRIM(NEW.tool), ''), 'Unknown')
                ) resources
                WHERE (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                   OR (db_path = OLD.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                   ))
                   OR (NEW.invoke_source_id IS NULL AND NEW.invoke_scope_hidden = 0)
                   OR (db_path = NEW.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = NEW.invoke_owner_id)
                   ));

                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT cache.scope_key, 'facet_resource', resources.facet_type, resources.resource_name
                FROM invoke_scope_cache_state cache
                CROSS JOIN (
                    SELECT 'loras' AS facet_type, lora_name AS resource_name
                    FROM image_loras WHERE image_id IN (OLD.id, NEW.id)
                    UNION SELECT 'embeddings', embedding_name
                    FROM image_embeddings WHERE image_id IN (OLD.id, NEW.id)
                    UNION SELECT 'hypernetworks', hypernetwork_name
                    FROM image_hypernetworks WHERE image_id IN (OLD.id, NEW.id)
                    UNION SELECT 'control_nets', controlnet_name
                    FROM image_controlnets WHERE image_id IN (OLD.id, NEW.id)
                    UNION SELECT 'ip_adapters', ipadapter_name
                    FROM image_ipadapters WHERE image_id IN (OLD.id, NEW.id)
                ) resources
                WHERE (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                   OR (cache.db_path = OLD.invoke_source_id AND (
                        cache.scope_mode IN ('legacy', 'all')
                        OR (cache.scope_mode = 'owner' AND cache.owner_id = OLD.invoke_owner_id)
                   ))
                   OR (NEW.invoke_source_id IS NULL AND NEW.invoke_scope_hidden = 0)
                   OR (cache.db_path = NEW.invoke_source_id AND (
                        cache.scope_mode IN ('legacy', 'all')
                        OR (cache.scope_mode = 'owner' AND cache.owner_id = NEW.invoke_owner_id)
                   ));

                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'collections', '', ''
                FROM invoke_scope_cache_state
                WHERE (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                   OR (db_path = OLD.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                   ))
                   OR (NEW.invoke_source_id IS NULL AND NEW.invoke_scope_hidden = 0)
                   OR (db_path = NEW.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = NEW.invoke_owner_id)
                   ));
            END;

            CREATE TRIGGER invoke_scope_cache_images_delete_detail
            AFTER DELETE ON images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'full', '', ''
                FROM invoke_scope_cache_state
                WHERE (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                   OR (db_path = OLD.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                   ));
            END;

            CREATE TRIGGER invoke_scope_cache_collections_insert_detail
            AFTER INSERT ON collections BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'collections', '', ''
                FROM invoke_scope_cache_state
                WHERE (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND (
                       COALESCE(NEW.source, 'ambit') != 'invoke'
                       OR (db_path = NEW.invoke_source_id AND (
                            scope_mode IN ('legacy', 'all')
                            OR (scope_mode = 'owner' AND owner_id = NEW.invoke_owner_id)
                       ))
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_collections_update_detail
            AFTER UPDATE OF filter_state, manual_exclusions, source, invoke_owner_id, invoke_source_id
            ON collections BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'collections', '', ''
                FROM invoke_scope_cache_state
                WHERE (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND (
                       COALESCE(OLD.source, 'ambit') != 'invoke'
                       OR (db_path = OLD.invoke_source_id AND (
                            scope_mode IN ('legacy', 'all')
                            OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                       ))
                       OR COALESCE(NEW.source, 'ambit') != 'invoke'
                       OR (db_path = NEW.invoke_source_id AND (
                            scope_mode IN ('legacy', 'all')
                            OR (scope_mode = 'owner' AND owner_id = NEW.invoke_owner_id)
                       ))
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_collections_delete_detail
            AFTER DELETE ON collections BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'collections', '', ''
                FROM invoke_scope_cache_state
                WHERE (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND (
                       COALESCE(OLD.source, 'ambit') != 'invoke'
                       OR (db_path = OLD.invoke_source_id AND (
                            scope_mode IN ('legacy', 'all')
                            OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                       ))
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_membership_insert_detail
            AFTER INSERT ON collection_images BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'collections', '', ''
                FROM invoke_scope_cache_visible_image_scopes
                WHERE (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND image_id = NEW.image_id;
            END;

            CREATE TRIGGER invoke_scope_cache_membership_delete_detail
            AFTER DELETE ON collection_images BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'collections', '', ''
                FROM invoke_scope_cache_visible_image_scopes
                WHERE (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND image_id = OLD.image_id;
            END;

            CREATE TRIGGER invoke_scope_cache_loras_insert_detail AFTER INSERT ON image_loras BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'loras', NEW.lora_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = NEW.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_loras_update_detail AFTER UPDATE ON image_loras BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'loras', resource_name
                FROM invoke_scope_cache_visible_image_scopes
                CROSS JOIN (SELECT OLD.lora_name AS resource_name UNION SELECT NEW.lora_name)
                WHERE image_id IN (OLD.image_id, NEW.image_id)
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_loras_delete_detail AFTER DELETE ON image_loras BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'loras', OLD.lora_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = OLD.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;

            CREATE TRIGGER invoke_scope_cache_embeddings_insert_detail AFTER INSERT ON image_embeddings BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'embeddings', NEW.embedding_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = NEW.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_embeddings_update_detail AFTER UPDATE ON image_embeddings BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'embeddings', resource_name
                FROM invoke_scope_cache_visible_image_scopes
                CROSS JOIN (SELECT OLD.embedding_name AS resource_name UNION SELECT NEW.embedding_name)
                WHERE image_id IN (OLD.image_id, NEW.image_id)
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_embeddings_delete_detail AFTER DELETE ON image_embeddings BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'embeddings', OLD.embedding_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = OLD.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;

            CREATE TRIGGER invoke_scope_cache_hypernetworks_insert_detail AFTER INSERT ON image_hypernetworks BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'hypernetworks', NEW.hypernetwork_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = NEW.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_hypernetworks_update_detail AFTER UPDATE ON image_hypernetworks BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'hypernetworks', resource_name
                FROM invoke_scope_cache_visible_image_scopes
                CROSS JOIN (SELECT OLD.hypernetwork_name AS resource_name UNION SELECT NEW.hypernetwork_name)
                WHERE image_id IN (OLD.image_id, NEW.image_id)
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_hypernetworks_delete_detail AFTER DELETE ON image_hypernetworks BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'hypernetworks', OLD.hypernetwork_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = OLD.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;

            CREATE TRIGGER invoke_scope_cache_controlnets_insert_detail AFTER INSERT ON image_controlnets BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'control_nets', NEW.controlnet_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = NEW.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_controlnets_update_detail AFTER UPDATE ON image_controlnets BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'control_nets', resource_name
                FROM invoke_scope_cache_visible_image_scopes
                CROSS JOIN (SELECT OLD.controlnet_name AS resource_name UNION SELECT NEW.controlnet_name)
                WHERE image_id IN (OLD.image_id, NEW.image_id)
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_controlnets_delete_detail AFTER DELETE ON image_controlnets BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'control_nets', OLD.controlnet_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = OLD.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;

            CREATE TRIGGER invoke_scope_cache_ipadapters_insert_detail AFTER INSERT ON image_ipadapters BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'ip_adapters', NEW.ipadapter_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = NEW.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_ipadapters_update_detail AFTER UPDATE ON image_ipadapters BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'ip_adapters', resource_name
                FROM invoke_scope_cache_visible_image_scopes
                CROSS JOIN (SELECT OLD.ipadapter_name AS resource_name UNION SELECT NEW.ipadapter_name)
                WHERE image_id IN (OLD.image_id, NEW.image_id)
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;
            CREATE TRIGGER invoke_scope_cache_ipadapters_delete_detail AFTER DELETE ON image_ipadapters BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'ip_adapters', OLD.ipadapter_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = OLD.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0;
            END;

            CREATE TRIGGER invoke_scope_cache_models_insert_detail AFTER INSERT ON models BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key,
                       CASE WHEN NEW.resource_type IN ('checkpoint', 'checkpoints', 'loras', 'embeddings', 'hypernetworks', 'control_nets', 'ip_adapters')
                            THEN 'facet_resource' ELSE 'full' END,
                       CASE NEW.resource_type WHEN 'checkpoint' THEN 'checkpoints' ELSE COALESCE(NEW.resource_type, '') END,
                       CASE WHEN NEW.resource_type IN ('checkpoint', 'checkpoints', 'loras', 'embeddings', 'hypernetworks', 'control_nets', 'ip_adapters')
                            THEN COALESCE(NEW.name, '') ELSE '' END
                FROM invoke_scope_cache_state
                WHERE (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND NOT (
                      status = 'building'
                      AND scope_key = (SELECT active_scope_key FROM invoke_scope_cache_control WHERE state_key = 'current')
                      AND (SELECT suppress_active_model_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 1
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_models_update_detail AFTER UPDATE ON models BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT cache.scope_key,
                       CASE WHEN resource_type IN ('checkpoint', 'checkpoints', 'loras', 'embeddings', 'hypernetworks', 'control_nets', 'ip_adapters')
                            THEN 'facet_resource' ELSE 'full' END,
                       CASE resource_type WHEN 'checkpoint' THEN 'checkpoints' ELSE COALESCE(resource_type, '') END,
                       CASE WHEN resource_type IN ('checkpoint', 'checkpoints', 'loras', 'embeddings', 'hypernetworks', 'control_nets', 'ip_adapters')
                            THEN COALESCE(resource_name, '') ELSE '' END
                FROM invoke_scope_cache_state cache
                CROSS JOIN (
                    SELECT OLD.resource_type AS resource_type, OLD.name AS resource_name
                    UNION SELECT NEW.resource_type, NEW.name
                ) resources
                WHERE (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND NOT (
                      cache.status = 'building'
                      AND cache.scope_key = (SELECT active_scope_key FROM invoke_scope_cache_control WHERE state_key = 'current')
                      AND (SELECT suppress_active_model_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 1
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_models_delete_detail AFTER DELETE ON models BEGIN
                INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                SELECT scope_key,
                       CASE WHEN OLD.resource_type IN ('checkpoint', 'checkpoints', 'loras', 'embeddings', 'hypernetworks', 'control_nets', 'ip_adapters')
                            THEN 'facet_resource' ELSE 'full' END,
                       CASE OLD.resource_type WHEN 'checkpoint' THEN 'checkpoints' ELSE COALESCE(OLD.resource_type, '') END,
                       CASE WHEN OLD.resource_type IN ('checkpoint', 'checkpoints', 'loras', 'embeddings', 'hypernetworks', 'control_nets', 'ip_adapters')
                            THEN COALESCE(OLD.name, '') ELSE '' END
                FROM invoke_scope_cache_state
                WHERE (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND NOT (
                      status = 'building'
                      AND scope_key = (SELECT active_scope_key FROM invoke_scope_cache_control WHERE state_key = 'current')
                      AND (SELECT suppress_active_model_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 1
                  );
            END;
        "#,
        kind: MigrationKind::Up,
    }
}
