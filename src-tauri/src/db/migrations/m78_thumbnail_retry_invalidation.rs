use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 78: Thumbnail retry diagnostics are operational metadata. Updating
/// them must not invalidate Invoke owner-scope facets or collection projections.
pub fn migration78() -> Migration {
    Migration {
        version: 78,
        description: "exclude_thumbnail_retry_diagnostics_from_scope_invalidation",
        sql: r#"
            DROP TRIGGER IF EXISTS invoke_scope_cache_images_update_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_images_update_detail;

            CREATE TRIGGER invoke_scope_cache_images_update_dirty
            AFTER UPDATE OF
                id, path, width, height, file_size, timestamp, metadata_json,
                thumbnail_path, is_favorite, is_pinned, is_deleted, is_missing,
                user_masked, group_id, notes, original_metadata_json, board_id,
                model_hash, model_name, tool, resolved_model_name, steps, cfg,
                sampler, generation_type, original_state_json, thumbnail_source,
                micro_thumbnail, positive_prompt, negative_prompt, is_corrupt,
                parser_version, original_parsed_json, privacy_hidden, file_hash,
                thumbnail_version, seed, invoke_image_name, invoke_image_category,
                invoke_image_origin, invoke_owner_id, invoke_source_id
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

            CREATE TRIGGER invoke_scope_cache_images_update_detail
            AFTER UPDATE OF
                id, path, width, height, file_size, timestamp, metadata_json,
                thumbnail_path, is_favorite, is_pinned, is_deleted, is_missing,
                user_masked, group_id, notes, original_metadata_json, board_id,
                model_hash, model_name, tool, resolved_model_name, steps, cfg,
                sampler, generation_type, original_state_json, thumbnail_source,
                micro_thumbnail, positive_prompt, negative_prompt, is_corrupt,
                parser_version, original_parsed_json, privacy_hidden, file_hash,
                thumbnail_version, seed, invoke_image_name, invoke_image_category,
                invoke_image_origin, invoke_owner_id, invoke_source_id
            ON images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
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
                  )
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;

                INSERT INTO invoke_scope_cache_dirty_items
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
                   ))
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;

                INSERT INTO invoke_scope_cache_dirty_items
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
                   ))
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;

                INSERT INTO invoke_scope_cache_dirty_items
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
                   ))
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;

                INSERT INTO invoke_scope_cache_dirty_items
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
                   ))
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration78;

    #[test]
    fn retry_diagnostics_do_not_participate_in_scope_invalidation() {
        let sql = migration78().sql;

        for trigger in [
            "CREATE TRIGGER invoke_scope_cache_images_update_dirty",
            "CREATE TRIGGER invoke_scope_cache_images_update_detail",
        ] {
            let trigger_start = sql.find(trigger).expect("trigger definition");
            let trigger_sql = &sql[trigger_start..];
            let update_columns =
                &trigger_sql[..trigger_sql.find("ON images").expect("trigger target")];

            assert!(update_columns.contains("thumbnail_path"));
            assert!(update_columns.contains("is_missing"));
            assert!(!update_columns.contains("thumbnail_failure_count"));
            assert!(!update_columns.contains("thumbnail_last_error"));
            assert!(!update_columns.contains("thumbnail_last_attempt_at"));
        }
    }
}
