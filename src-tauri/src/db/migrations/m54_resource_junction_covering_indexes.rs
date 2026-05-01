use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 54: Add covering indexes for Live Watch resource-row facet refreshes.
pub fn migration54() -> Migration {
    Migration {
        version: 54,
        description: "add_resource_junction_covering_indexes",
        sql: r#"
            CREATE INDEX IF NOT EXISTS idx_lora_by_name_image_v1
                ON image_loras(lora_name, image_id);

            CREATE INDEX IF NOT EXISTS idx_embedding_by_name_image_v1
                ON image_embeddings(embedding_name, image_id);

            CREATE INDEX IF NOT EXISTS idx_hypernetwork_by_name_image_v1
                ON image_hypernetworks(hypernetwork_name, image_id);

            CREATE INDEX IF NOT EXISTS idx_controlnet_by_name_image_v1
                ON image_controlnets(controlnet_name, image_id);

            CREATE INDEX IF NOT EXISTS idx_ipadapter_by_name_image_v1
                ON image_ipadapters(ipadapter_name, image_id);

            ANALYZE image_loras;
            ANALYZE image_embeddings;
            ANALYZE image_hypernetworks;
            ANALYZE image_controlnets;
            ANALYZE image_ipadapters;
        "#,
        kind: MigrationKind::Up,
    }
}
