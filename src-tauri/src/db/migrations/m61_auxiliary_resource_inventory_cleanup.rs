use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 61: Remove additional auxiliary model files from Assets inventory.
///
/// Migration 60 removed the first wave of unsupported disk-scan rows, but real
/// ComfyUI libraries also store face restore, upscaler, caption/VLM, LLM, and
/// similar utility models in folders whose filenames look checkpoint-like.
/// Those rows should not appear as local-only checkpoints.
pub fn migration61() -> Migration {
    Migration {
        version: 61,
        description: "cleanup_auxiliary_resource_inventory",
        sql: r#"
            DROP TABLE IF EXISTS auxiliary_resource_inventory_paths;
            CREATE TEMP TABLE auxiliary_resource_inventory_paths AS
                SELECT
                    m.hash,
                    '/' || lower(replace(substr(m.hash, 6), char(92), '/')) || '/' AS path_key
                FROM models m
                WHERE m.lookup_source = 'disk_scan'
                  AND m.hash LIKE 'file:%';

            DROP TABLE IF EXISTS auxiliary_resource_inventory_unsupported;
            CREATE TEMP TABLE auxiliary_resource_inventory_unsupported AS
                SELECT hash
                FROM auxiliary_resource_inventory_paths
                WHERE path_key NOT LIKE '%/lora/%'
                  AND path_key NOT LIKE '%/loras/%'
                  AND (
                    path_key LIKE '%/facedetection/%'
                    OR path_key LIKE '%/face_detection/%'
                    OR path_key LIKE '%/facerestore/%'
                    OR path_key LIKE '%/face_restore/%'
                    OR path_key LIKE '%/florence2/%'
                    OR path_key LIKE '%/florence-2/%'
                    OR path_key LIKE '%/florence_2/%'
                    OR path_key LIKE '%/gfpgan/%'
                    OR path_key LIKE '%/ldsr/%'
                    OR path_key LIKE '%/llm/%'
                    OR path_key LIKE '%/omnisr/%'
                    OR path_key LIKE '%/pulid/%'
                    OR path_key LIKE '%/realesrgan/%'
                    OR path_key LIKE '%/real-esrgan/%'
                    OR path_key LIKE '%/real_esrgan/%'
                    OR path_key LIKE '%/sams/%'
                    OR path_key LIKE '%/seedvr2/%'
                    OR path_key LIKE '%/swinir/%'
                    OR path_key LIKE '%/t2iadapter/%'
                  );

            DELETE FROM facet_cache
            WHERE IFNULL(count, 0) = 0
              AND resource_hash IN (SELECT hash FROM auxiliary_resource_inventory_unsupported);

            DELETE FROM models
            WHERE lookup_source = 'disk_scan'
              AND hash IN (SELECT hash FROM auxiliary_resource_inventory_unsupported);

            DELETE FROM scanned_files
            WHERE hash IN (SELECT hash FROM auxiliary_resource_inventory_unsupported)
              AND NOT EXISTS (
                SELECT 1 FROM models m WHERE m.hash = scanned_files.hash
              );

            DROP TABLE IF EXISTS auxiliary_resource_inventory_unsupported;
            DROP TABLE IF EXISTS auxiliary_resource_inventory_paths;

            ANALYZE models;
            ANALYZE facet_cache;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration61;

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
                resource_type TEXT
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
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count)
             VALUES (?1, ?2, ?3, 0)",
            rusqlite::params![
                if resource_type == "checkpoint" {
                    "checkpoints"
                } else {
                    resource_type
                },
                name,
                hash
            ],
        )
        .expect("insert facet row");
    }

    #[test]
    fn migration_removes_additional_auxiliary_checkpoint_pollution() {
        let conn = setup_conn();
        let unsupported = [
            (
                "D:/AmbitFixtures/Models/facerestore/GFPGANv1.4.pth",
                "GFPGANv1.4",
            ),
            (
                "D:/AmbitFixtures/Models/facedetection/detection_mobilenet0.25_Final.pth",
                "detection_mobilenet0.25_Final",
            ),
            (
                "D:/AmbitFixtures/Models/RealESRGAN/RealESRGAN_x4plus.pth",
                "RealESRGAN_x4plus",
            ),
            ("D:/AmbitFixtures/Models/SwinIR/SwinIR_4x.pth", "SwinIR_4x"),
            (
                "D:/AmbitFixtures/Models/LLM/LLaVA/model-00001-of-00004.safetensors",
                "model-00001-of-00004",
            ),
            (
                "D:/AmbitFixtures/Models/florence2/base/pytorch_model.bin",
                "pytorch_model",
            ),
            (
                "D:/AmbitFixtures/Models/T2IAdapter/t2i-adapter-canny-sdxl-1.0/diffusion_pytorch_model.safetensors",
                "diffusion_pytorch_model",
            ),
            ("D:/AmbitFixtures/Models/pulid/pulid_flux_v0.9.1.safetensors", "pulid_flux_v0.9.1"),
            ("D:/AmbitFixtures/Models/sams/sam_hq_vit_b.pth", "sam_hq_vit_b"),
            (
                "D:/AmbitFixtures/Models/SEEDVR2/ema_vae_fp16.safetensors",
                "ema_vae_fp16",
            ),
        ];

        for (path, name) in unsupported {
            insert_disk_model(&conn, path, name, "checkpoint");
        }
        insert_disk_model(
            &conn,
            "D:/AmbitFixtures/Models/checkpoints/real_checkpoint.safetensors",
            "real_checkpoint",
            "checkpoint",
        );
        insert_disk_model(
            &conn,
            "D:/AmbitFixtures/Models/loras/real_lora.safetensors",
            "real_lora",
            "loras",
        );

        conn.execute_batch(migration61().sql)
            .expect("apply migration");

        let disk_rows: Vec<String> = conn
            .prepare("SELECT name FROM models ORDER BY name")
            .expect("prepare model query")
            .query_map([], |row| row.get(0))
            .expect("query models")
            .collect::<Result<_, _>>()
            .expect("collect models");

        assert_eq!(disk_rows, vec!["real_checkpoint", "real_lora"]);

        let facet_rows: Vec<String> = conn
            .prepare("SELECT resource_name FROM facet_cache ORDER BY resource_name")
            .expect("prepare facet query")
            .query_map([], |row| row.get(0))
            .expect("query facets")
            .collect::<Result<_, _>>()
            .expect("collect facets");

        assert_eq!(facet_rows, vec!["real_checkpoint", "real_lora"]);

        let scanned_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM scanned_files", [], |row| row.get(0))
            .expect("count scanned files");
        assert_eq!(scanned_count, 2);
    }

    #[test]
    fn migration_preserves_lora_assets_inside_matching_auxiliary_names() {
        let conn = setup_conn();
        insert_disk_model(
            &conn,
            "D:/AmbitFixtures/Models/loras/facerestore_style.safetensors",
            "facerestore_style",
            "loras",
        );

        conn.execute_batch(migration61().sql)
            .expect("apply migration");

        let model_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM models", [], |row| row.get(0))
            .expect("count models");
        let facet_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM facet_cache", [], |row| row.get(0))
            .expect("count facets");

        assert_eq!(model_count, 1);
        assert_eq!(facet_count, 1);
    }
}
