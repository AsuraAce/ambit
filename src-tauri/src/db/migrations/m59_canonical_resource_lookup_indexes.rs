use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 59: Add expression indexes for canonical resource filtering.
///
/// Facet rows are displayed by canonical resource name, while older or reparsed
/// junction rows may still include weight suffixes such as `Name (0.20)` or
/// `Name:0.20`. These indexes keep canonical filter predicates fast.
pub fn migration59() -> Migration {
    Migration {
        version: 59,
        description: "add_canonical_resource_lookup_indexes",
        sql: r#"
            CREATE INDEX IF NOT EXISTS idx_lora_canonical_name_image_v1
                ON image_loras (
                    (CASE
                        WHEN instr(lora_name, ' (') > 0 THEN trim(substr(lora_name, 1, instr(lora_name, ' (') - 1))
                        WHEN instr(lora_name, ':') > 0 THEN trim(substr(lora_name, 1, instr(lora_name, ':') - 1))
                        ELSE trim(lora_name)
                    END) COLLATE NOCASE,
                    image_id
                );

            CREATE INDEX IF NOT EXISTS idx_embedding_canonical_name_image_v1
                ON image_embeddings (
                    (CASE
                        WHEN instr(embedding_name, ' (') > 0 THEN trim(substr(embedding_name, 1, instr(embedding_name, ' (') - 1))
                        WHEN instr(embedding_name, ':') > 0 THEN trim(substr(embedding_name, 1, instr(embedding_name, ':') - 1))
                        ELSE trim(embedding_name)
                    END) COLLATE NOCASE,
                    image_id
                );

            CREATE INDEX IF NOT EXISTS idx_hypernetwork_canonical_name_image_v1
                ON image_hypernetworks (
                    (CASE
                        WHEN instr(hypernetwork_name, ' (') > 0 THEN trim(substr(hypernetwork_name, 1, instr(hypernetwork_name, ' (') - 1))
                        WHEN instr(hypernetwork_name, ':') > 0 THEN trim(substr(hypernetwork_name, 1, instr(hypernetwork_name, ':') - 1))
                        ELSE trim(hypernetwork_name)
                    END) COLLATE NOCASE,
                    image_id
                );

            CREATE INDEX IF NOT EXISTS idx_controlnet_canonical_name_image_v1
                ON image_controlnets (
                    (CASE
                        WHEN instr(controlnet_name, ' (') > 0 THEN trim(substr(controlnet_name, 1, instr(controlnet_name, ' (') - 1))
                        WHEN instr(controlnet_name, ':') > 0 THEN trim(substr(controlnet_name, 1, instr(controlnet_name, ':') - 1))
                        ELSE trim(controlnet_name)
                    END) COLLATE NOCASE,
                    image_id
                );

            CREATE INDEX IF NOT EXISTS idx_ipadapter_canonical_name_image_v1
                ON image_ipadapters (
                    (CASE
                        WHEN instr(ipadapter_name, ' (') > 0 THEN trim(substr(ipadapter_name, 1, instr(ipadapter_name, ' (') - 1))
                        WHEN instr(ipadapter_name, ':') > 0 THEN trim(substr(ipadapter_name, 1, instr(ipadapter_name, ':') - 1))
                        ELSE trim(ipadapter_name)
                    END) COLLATE NOCASE,
                    image_id
                );

            ANALYZE image_loras;
            ANALYZE image_embeddings;
            ANALYZE image_hypernetworks;
            ANALYZE image_controlnets;
            ANALYZE image_ipadapters;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration59;

    const LORA_CANONICAL_EXPR: &str = "CASE
                        WHEN instr(lora_name, ' (') > 0 THEN trim(substr(lora_name, 1, instr(lora_name, ' (') - 1))
                        WHEN instr(lora_name, ':') > 0 THEN trim(substr(lora_name, 1, instr(lora_name, ':') - 1))
                        ELSE trim(lora_name)
                    END";

    #[test]
    fn migration_adds_canonical_resource_expression_indexes() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE image_loras (image_id TEXT NOT NULL, lora_name TEXT NOT NULL);
            CREATE TABLE image_embeddings (image_id TEXT NOT NULL, embedding_name TEXT NOT NULL);
            CREATE TABLE image_hypernetworks (image_id TEXT NOT NULL, hypernetwork_name TEXT NOT NULL);
            CREATE TABLE image_controlnets (image_id TEXT NOT NULL, controlnet_name TEXT NOT NULL);
            CREATE TABLE image_ipadapters (image_id TEXT NOT NULL, ipadapter_name TEXT NOT NULL);
            "#,
        )
        .expect("setup resource tables");

        conn.execute_batch(migration59().sql)
            .expect("apply migration");

        for index_name in [
            "idx_lora_canonical_name_image_v1",
            "idx_embedding_canonical_name_image_v1",
            "idx_hypernetwork_canonical_name_image_v1",
            "idx_controlnet_canonical_name_image_v1",
            "idx_ipadapter_canonical_name_image_v1",
        ] {
            let found: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                    [index_name],
                    |row| row.get(0),
                )
                .expect("query sqlite_master");
            assert_eq!(found, 1, "{index_name} should be created");
        }
    }

    #[test]
    fn canonical_lora_lookup_uses_expression_index_and_matches_weighted_rows() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE image_loras (image_id TEXT NOT NULL, lora_name TEXT NOT NULL);
            CREATE TABLE image_embeddings (image_id TEXT NOT NULL, embedding_name TEXT NOT NULL);
            CREATE TABLE image_hypernetworks (image_id TEXT NOT NULL, hypernetwork_name TEXT NOT NULL);
            CREATE TABLE image_controlnets (image_id TEXT NOT NULL, controlnet_name TEXT NOT NULL);
            CREATE TABLE image_ipadapters (image_id TEXT NOT NULL, ipadapter_name TEXT NOT NULL);

            INSERT INTO image_loras (image_id, lora_name) VALUES
                ('exact', 'detail___add_detail'),
                ('weighted', 'detail___add_detail (0.20)'),
                ('colon', 'detail___add_detail:0.20'),
                ('other', 'different_lora');
            "#,
        )
        .expect("setup resource rows");
        conn.execute_batch(migration59().sql)
            .expect("apply migration");

        let matching_images: Vec<String> = conn
            .prepare(&format!(
                "SELECT image_id FROM image_loras
                 WHERE ({LORA_CANONICAL_EXPR}) COLLATE NOCASE = ?1
                 ORDER BY image_id"
            ))
            .expect("prepare canonical lookup")
            .query_map(["DETAIL___ADD_DETAIL"], |row| row.get(0))
            .expect("query canonical lookup")
            .collect::<Result<_, _>>()
            .expect("collect canonical lookup");

        assert_eq!(matching_images, vec!["colon", "exact", "weighted"]);

        let plan: Vec<String> = conn
            .prepare(&format!(
                "EXPLAIN QUERY PLAN
                 SELECT image_id FROM image_loras
                 WHERE ({LORA_CANONICAL_EXPR}) COLLATE NOCASE = ?1"
            ))
            .expect("prepare query plan")
            .query_map(["detail___add_detail"], |row| row.get::<_, String>(3))
            .expect("query plan")
            .collect::<Result<_, _>>()
            .expect("collect query plan");

        assert!(
            plan.iter()
                .any(|detail| detail.contains("idx_lora_canonical_name_image_v1")),
            "canonical LoRA lookup should use expression index, plan was: {plan:?}"
        );
    }
}
