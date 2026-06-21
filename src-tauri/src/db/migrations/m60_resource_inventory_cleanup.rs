use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 60: Clean up disk-scanned resource inventory.
///
/// Earlier disk scans classified every unknown model-looking file as a
/// checkpoint, and broad substring matching split IP-adapters/control models
/// across the wrong resource sections. This is a data cleanup only: image
/// metadata and embedded raw metadata stay untouched.
pub fn migration60() -> Migration {
    Migration {
        version: 60,
        description: "cleanup_disk_resource_inventory",
        sql: r#"
            DROP TABLE IF EXISTS resource_inventory_paths;
            CREATE TEMP TABLE resource_inventory_paths AS
                SELECT
                    m.hash,
                    lower(replace(substr(m.hash, 6), char(92), '/')) AS canonical_path,
                    '/' || lower(replace(substr(m.hash, 6), char(92), '/')) || '/' AS path_key
                FROM models m
                WHERE m.lookup_source = 'disk_scan'
                  AND m.hash LIKE 'file:%';

            DROP TABLE IF EXISTS resource_inventory_unsupported;
            CREATE TEMP TABLE resource_inventory_unsupported AS
                SELECT hash
                FROM resource_inventory_paths
                WHERE path_key NOT LIKE '%/lora/%'
                  AND path_key NOT LIKE '%/loras/%'
                  AND (
                    path_key LIKE '%/vae/%'
                    OR path_key LIKE '%/vae_approx/%'
                    OR path_key LIKE '%/clip/%'
                    OR path_key LIKE '%/clip_vision/%'
                    OR path_key LIKE '%/text_encoder/%'
                    OR path_key LIKE '%/text_encoders/%'
                    OR path_key LIKE '%/upscale_model/%'
                    OR path_key LIKE '%/upscale_models/%'
                    OR path_key LIKE '%/upscaler/%'
                    OR path_key LIKE '%/upscalers/%'
                    OR path_key LIKE '%/ultralytics/%'
                    OR path_key LIKE '%/detector/%'
                    OR path_key LIKE '%/detectors/%'
                    OR path_key LIKE '%/bbox/%'
                    OR path_key LIKE '%/segm/%'
                    OR path_key LIKE '%/sam/%'
                    OR path_key LIKE '%/caption/%'
                    OR path_key LIKE '%/captions/%'
                    OR path_key LIKE '%/caption_models/%'
                    OR path_key LIKE '%/joy_caption/%'
                    OR path_key LIKE '%/wd14_tagger/%'
                    OR path_key LIKE '%/insightface/%'
                  );

            DELETE FROM facet_cache
            WHERE IFNULL(count, 0) = 0
              AND resource_hash IN (SELECT hash FROM resource_inventory_unsupported);

            DELETE FROM models
            WHERE lookup_source = 'disk_scan'
              AND hash IN (SELECT hash FROM resource_inventory_unsupported);

            DELETE FROM scanned_files
            WHERE hash IN (SELECT hash FROM resource_inventory_unsupported)
              AND NOT EXISTS (
                SELECT 1 FROM models m WHERE m.hash = scanned_files.hash
              );

            DROP TABLE IF EXISTS resource_inventory_ipadapters;
            CREATE TEMP TABLE resource_inventory_ipadapters AS
                SELECT p.hash
                FROM resource_inventory_paths p
                JOIN models m ON m.hash = p.hash
                WHERE m.lookup_source = 'disk_scan'
                  AND p.path_key NOT LIKE '%/lora/%'
                  AND p.path_key NOT LIKE '%/loras/%'
                  AND (
                    p.path_key LIKE '%ipadapter%'
                    OR p.path_key LIKE '%ip-adapter%'
                    OR p.path_key LIKE '%ip_adapter%'
                    OR p.path_key LIKE '%ipadapters%'
                  );

            DELETE FROM facet_cache
            WHERE resource_hash IN (SELECT hash FROM resource_inventory_ipadapters)
              AND facet_type != 'ip_adapters'
              AND EXISTS (
                SELECT 1
                FROM facet_cache target
                WHERE target.facet_type = 'ip_adapters'
                  AND target.resource_name = facet_cache.resource_name
              );

            UPDATE facet_cache
            SET facet_type = 'ip_adapters'
            WHERE resource_hash IN (SELECT hash FROM resource_inventory_ipadapters);

            UPDATE models
            SET resource_type = 'ip_adapters'
            WHERE hash IN (SELECT hash FROM resource_inventory_ipadapters);

            DROP TABLE IF EXISTS resource_inventory_controlnets;
            CREATE TEMP TABLE resource_inventory_controlnets AS
                SELECT p.hash
                FROM resource_inventory_paths p
                JOIN models m ON m.hash = p.hash
                WHERE m.lookup_source = 'disk_scan'
                  AND p.path_key NOT LIKE '%/lora/%'
                  AND p.path_key NOT LIKE '%/loras/%'
                  AND p.hash NOT IN (SELECT hash FROM resource_inventory_ipadapters)
                  AND (
                    p.path_key LIKE '%/controlnet/%'
                    OR p.path_key LIKE '%/control_net/%'
                    OR p.path_key LIKE '%/control-nets/%'
                    OR p.path_key LIKE '%/controlnets/%'
                    OR p.path_key LIKE '%/control_nets/%'
                    OR p.path_key LIKE '%/t2i_adapter/%'
                    OR p.path_key LIKE '%/t2i-adapter/%'
                  );

            DELETE FROM facet_cache
            WHERE resource_hash IN (SELECT hash FROM resource_inventory_controlnets)
              AND facet_type != 'control_nets'
              AND EXISTS (
                SELECT 1
                FROM facet_cache target
                WHERE target.facet_type = 'control_nets'
                  AND target.resource_name = facet_cache.resource_name
              );

            UPDATE facet_cache
            SET facet_type = 'control_nets'
            WHERE resource_hash IN (SELECT hash FROM resource_inventory_controlnets);

            UPDATE models
            SET resource_type = 'control_nets'
            WHERE hash IN (SELECT hash FROM resource_inventory_controlnets);

            DROP TABLE IF EXISTS resource_inventory_ranked;
            CREATE TEMP TABLE resource_inventory_ranked AS
                SELECT
                    p.hash,
                    FIRST_VALUE(p.hash) OVER (
                        PARTITION BY p.canonical_path, COALESCE(m.resource_type, '')
                        ORDER BY
                            CASE
                                WHEN NULLIF(m.thumbnail_path, '') IS NOT NULL
                                  OR NULLIF(m.sidecar_thumbnail_path, '') IS NOT NULL
                                  OR NULLIF(m.preview_url, '') IS NOT NULL
                                  OR NULLIF(m.thumbnail_mode, '') IS NOT NULL
                                  OR m.thumbnail_sensitivity_override IS NOT NULL
                                  OR NULLIF(m.guidance_category, '') IS NOT NULL
                                  OR NULLIF(m.guidance_subtype, '') IS NOT NULL
                                THEN 0 ELSE 1
                            END,
                            CASE WHEN instr(substr(p.hash, 6), '/') > 0 THEN 0 ELSE 1 END,
                            p.hash
                    ) AS keep_hash,
                    COUNT(*) OVER (
                        PARTITION BY p.canonical_path, COALESCE(m.resource_type, '')
                    ) AS duplicate_count
                FROM resource_inventory_paths p
                JOIN models m ON m.hash = p.hash
                WHERE m.lookup_source = 'disk_scan';

            DROP TABLE IF EXISTS resource_inventory_duplicates;
            CREATE TEMP TABLE resource_inventory_duplicates AS
                SELECT hash AS delete_hash, keep_hash
                FROM resource_inventory_ranked
                WHERE duplicate_count > 1
                  AND hash != keep_hash;

            UPDATE models
            SET
                thumbnail_path = COALESCE(
                    NULLIF(thumbnail_path, ''),
                    (
                        SELECT NULLIF(d.thumbnail_path, '')
                        FROM models d
                        JOIN resource_inventory_duplicates dup ON dup.delete_hash = d.hash
                        WHERE dup.keep_hash = models.hash
                          AND NULLIF(d.thumbnail_path, '') IS NOT NULL
                        LIMIT 1
                    )
                ),
                sidecar_thumbnail_path = COALESCE(
                    NULLIF(sidecar_thumbnail_path, ''),
                    (
                        SELECT NULLIF(d.sidecar_thumbnail_path, '')
                        FROM models d
                        JOIN resource_inventory_duplicates dup ON dup.delete_hash = d.hash
                        WHERE dup.keep_hash = models.hash
                          AND NULLIF(d.sidecar_thumbnail_path, '') IS NOT NULL
                        LIMIT 1
                    )
                ),
                preview_url = COALESCE(
                    NULLIF(preview_url, ''),
                    (
                        SELECT NULLIF(d.preview_url, '')
                        FROM models d
                        JOIN resource_inventory_duplicates dup ON dup.delete_hash = d.hash
                        WHERE dup.keep_hash = models.hash
                          AND NULLIF(d.preview_url, '') IS NOT NULL
                        LIMIT 1
                    )
                ),
                thumbnail_mode = COALESCE(
                    NULLIF(thumbnail_mode, ''),
                    (
                        SELECT NULLIF(d.thumbnail_mode, '')
                        FROM models d
                        JOIN resource_inventory_duplicates dup ON dup.delete_hash = d.hash
                        WHERE dup.keep_hash = models.hash
                          AND NULLIF(d.thumbnail_mode, '') IS NOT NULL
                        LIMIT 1
                    )
                ),
                thumbnail_sensitivity_override = COALESCE(
                    thumbnail_sensitivity_override,
                    (
                        SELECT d.thumbnail_sensitivity_override
                        FROM models d
                        JOIN resource_inventory_duplicates dup ON dup.delete_hash = d.hash
                        WHERE dup.keep_hash = models.hash
                          AND d.thumbnail_sensitivity_override IS NOT NULL
                        LIMIT 1
                    )
                ),
                guidance_category = COALESCE(
                    NULLIF(guidance_category, ''),
                    (
                        SELECT NULLIF(d.guidance_category, '')
                        FROM models d
                        JOIN resource_inventory_duplicates dup ON dup.delete_hash = d.hash
                        WHERE dup.keep_hash = models.hash
                          AND NULLIF(d.guidance_category, '') IS NOT NULL
                        LIMIT 1
                    )
                ),
                guidance_subtype = COALESCE(
                    NULLIF(guidance_subtype, ''),
                    (
                        SELECT NULLIF(d.guidance_subtype, '')
                        FROM models d
                        JOIN resource_inventory_duplicates dup ON dup.delete_hash = d.hash
                        WHERE dup.keep_hash = models.hash
                          AND NULLIF(d.guidance_subtype, '') IS NOT NULL
                        LIMIT 1
                    )
                )
            WHERE hash IN (
                SELECT DISTINCT keep_hash FROM resource_inventory_duplicates
            );

            UPDATE facet_cache
            SET resource_hash = (
                SELECT dup.keep_hash
                FROM resource_inventory_duplicates dup
                WHERE dup.delete_hash = facet_cache.resource_hash
            )
            WHERE resource_hash IN (
                SELECT delete_hash FROM resource_inventory_duplicates
            );

            DELETE FROM models
            WHERE hash IN (
                SELECT delete_hash FROM resource_inventory_duplicates
            );

            DELETE FROM scanned_files
            WHERE hash IN (
                SELECT delete_hash FROM resource_inventory_duplicates
            )
              AND NOT EXISTS (
                SELECT 1 FROM models m WHERE m.hash = scanned_files.hash
              );

            DROP TABLE IF EXISTS resource_inventory_duplicates;
            DROP TABLE IF EXISTS resource_inventory_ranked;
            DROP TABLE IF EXISTS resource_inventory_controlnets;
            DROP TABLE IF EXISTS resource_inventory_ipadapters;
            DROP TABLE IF EXISTS resource_inventory_unsupported;
            DROP TABLE IF EXISTS resource_inventory_paths;

            ANALYZE models;
            ANALYZE facet_cache;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration60;

    fn setup_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE models (
                hash TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                filename TEXT,
                lookup_source TEXT,
                civitai_version_id INTEGER,
                scanned_at INTEGER,
                thumbnail_path TEXT,
                preview_url TEXT,
                resource_type TEXT,
                guidance_category TEXT,
                guidance_subtype TEXT,
                sidecar_thumbnail_path TEXT,
                thumbnail_mode TEXT,
                thumbnail_sensitivity_override INTEGER
            );

            CREATE TABLE scanned_files (
                path TEXT PRIMARY KEY,
                size INTEGER,
                modified INTEGER,
                hash TEXT
            );

            CREATE TABLE facet_cache (
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
                PRIMARY KEY (facet_type, resource_name)
            );
            "#,
        )
        .expect("create test schema");
        conn
    }

    fn insert_disk_model(conn: &rusqlite::Connection, path: &str, name: &str, resource_type: &str) {
        let hash = format!("file:{path}");
        conn.execute(
            "INSERT INTO models (hash, name, filename, lookup_source, scanned_at, resource_type)
             VALUES (?1, ?2, ?3, 'disk_scan', 100, ?4)",
            rusqlite::params![hash, name, format!("{name}.safetensors"), resource_type],
        )
        .expect("insert model");
        conn.execute(
            "INSERT INTO scanned_files (path, size, modified, hash)
             VALUES (?1, 10, 20, ?2)",
            rusqlite::params![path, hash],
        )
        .expect("insert scanned file");
    }

    fn insert_zero_count_facet(
        conn: &rusqlite::Connection,
        facet_type: &str,
        name: &str,
        hash: &str,
    ) {
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count)
             VALUES (?1, ?2, ?3, 0)",
            rusqlite::params![facet_type, name, hash],
        )
        .expect("insert facet row");
    }

    #[test]
    fn migration_removes_unsupported_checkpoint_pollution() {
        let conn = setup_conn();
        let vae_path = "C:/ComfyUI/models/vae/sdxl_vae.safetensors";
        let vae_hash = format!("file:{vae_path}");
        insert_disk_model(&conn, vae_path, "sdxl_vae", "checkpoint");
        insert_zero_count_facet(&conn, "checkpoints", "sdxl_vae", &vae_hash);

        conn.execute_batch(migration60().sql)
            .expect("apply migration");

        let model_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM models", [], |row| row.get(0))
            .expect("count models");
        let facet_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM facet_cache", [], |row| row.get(0))
            .expect("count facets");
        let scanned_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM scanned_files", [], |row| row.get(0))
            .expect("count scanned files");

        assert_eq!(model_count, 0);
        assert_eq!(facet_count, 0);
        assert_eq!(scanned_count, 0);
    }

    #[test]
    fn migration_reclassifies_ip_adapters_and_control_models_without_touching_lora_variants() {
        let conn = setup_conn();
        let ip_path = "C:/ComfyUI/models/controlnet/ip-adapter-faceid.safetensors";
        let ip_hash = format!("file:{ip_path}");
        let control_lora_path = "C:/ComfyUI/models/controlnet/control-lora-canny.safetensors";
        let control_lora_hash = format!("file:{control_lora_path}");
        let lora_ip_path = "C:/ComfyUI/models/loras/ip-adapter-faceid-lora.safetensors";
        let lora_ip_hash = format!("file:{lora_ip_path}");

        insert_disk_model(&conn, ip_path, "ip-adapter-faceid", "control_nets");
        insert_zero_count_facet(&conn, "control_nets", "ip-adapter-faceid", &ip_hash);
        insert_disk_model(&conn, control_lora_path, "control-lora-canny", "loras");
        insert_zero_count_facet(&conn, "loras", "control-lora-canny", &control_lora_hash);
        insert_disk_model(&conn, lora_ip_path, "ip-adapter-faceid-lora", "loras");
        insert_zero_count_facet(&conn, "loras", "ip-adapter-faceid-lora", &lora_ip_hash);

        conn.execute_batch(migration60().sql)
            .expect("apply migration");

        let ip_type: String = conn
            .query_row(
                "SELECT resource_type FROM models WHERE hash = ?1",
                [&ip_hash],
                |row| row.get(0),
            )
            .expect("ip resource type");
        let ip_facet: String = conn
            .query_row(
                "SELECT facet_type FROM facet_cache WHERE resource_hash = ?1",
                [&ip_hash],
                |row| row.get(0),
            )
            .expect("ip facet type");
        let control_type: String = conn
            .query_row(
                "SELECT resource_type FROM models WHERE hash = ?1",
                [&control_lora_hash],
                |row| row.get(0),
            )
            .expect("control resource type");
        let lora_type: String = conn
            .query_row(
                "SELECT resource_type FROM models WHERE hash = ?1",
                [&lora_ip_hash],
                |row| row.get(0),
            )
            .expect("lora resource type");

        assert_eq!(ip_type, "ip_adapters");
        assert_eq!(ip_facet, "ip_adapters");
        assert_eq!(control_type, "control_nets");
        assert_eq!(lora_type, "loras");
    }

    #[test]
    fn migration_collapses_slash_variant_disk_rows_and_preserves_customization() {
        let conn = setup_conn();
        let first_path = "D:/AI/models/loras/Detailer.safetensors";
        let second_path = "D:/AI/models\\loras\\Detailer.safetensors";
        let first_hash = format!("file:{first_path}");
        let second_hash = format!("file:{second_path}");

        insert_disk_model(&conn, first_path, "Detailer", "loras");
        insert_disk_model(&conn, second_path, "Detailer", "loras");
        conn.execute(
            "UPDATE models
             SET thumbnail_path = 'C:/thumbs/detailer.webp',
                 sidecar_thumbnail_path = 'D:/AI/models/loras/Detailer.preview.png',
                 thumbnail_sensitivity_override = 1
             WHERE hash = ?1",
            [&second_hash],
        )
        .expect("customize duplicate");
        insert_zero_count_facet(&conn, "loras", "Detailer", &second_hash);

        conn.execute_batch(migration60().sql)
            .expect("apply migration");

        let rows: Vec<(String, Option<String>, Option<String>, Option<i64>)> = conn
            .prepare(
                "SELECT hash, thumbnail_path, sidecar_thumbnail_path, thumbnail_sensitivity_override
                 FROM models WHERE name = 'Detailer'",
            )
            .expect("prepare detailer query")
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .expect("query detailer rows")
            .collect::<Result<_, _>>()
            .expect("collect detailer rows");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].1.as_deref(), Some("C:/thumbs/detailer.webp"));
        assert_eq!(
            rows[0].2.as_deref(),
            Some("D:/AI/models/loras/Detailer.preview.png")
        );
        assert_eq!(rows[0].3, Some(1));

        let facet_hash: String = conn
            .query_row(
                "SELECT resource_hash FROM facet_cache WHERE facet_type = 'loras' AND resource_name = 'Detailer'",
                [],
                |row| row.get(0),
            )
            .expect("facet hash");
        assert_eq!(facet_hash, rows[0].0);

        let scanned_hashes: Vec<String> = conn
            .prepare("SELECT hash FROM scanned_files ORDER BY hash")
            .expect("prepare scanned query")
            .query_map([], |row| row.get(0))
            .expect("query scanned rows")
            .collect::<Result<_, _>>()
            .expect("collect scanned rows");
        assert_eq!(scanned_hashes, vec![rows[0].0.clone()]);
        assert!(rows[0].0 == first_hash || rows[0].0 == second_hash);
    }
}
