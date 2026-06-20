use super::run_blocking;
use rusqlite::types::Value;
use tauri::AppHandle;

const SEED_BACKFILL_EXPRESSION: &str = "CASE
                    WHEN json_type(metadata_json, '$.seed') IN ('integer', 'real')
                    THEN CAST(json_extract(metadata_json, '$.seed') AS INTEGER)
                    ELSE NULL
                END";

fn resource_clean_ref_sql(column: &str) -> String {
    format!(
        "CASE
            WHEN instr({column}, ' (') > 0 THEN trim(substr({column}, 1, instr({column}, ' (') - 1))
            WHEN instr({column}, ':') > 0 THEN trim(substr({column}, 1, instr({column}, ':') - 1))
            ELSE trim({column})
        END"
    )
}

#[derive(serde::Serialize, specta::Type)]
pub struct NumericRange {
    pub min: f64,
    pub max: f64,
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ParameterRanges {
    pub steps: Option<NumericRange>,
    pub cfg: Option<NumericRange>,
    pub denoising_strength: Option<NumericRange>,
    pub samplers: Vec<String>,
    pub generation_types: Vec<String>,
    pub control_nets: Vec<String>,
    pub ip_adapters: Vec<String>,
    pub guidance_subtypes: std::collections::HashMap<String, String>,
}

fn build_parameter_scope_from_clause(
    collection_id: Option<&str>,
    lora_name: Option<&str>,
) -> (String, Vec<Value>) {
    let mut from_clause = "FROM images".to_string();
    let mut join_params = Vec::new();

    if let Some(col_id) = collection_id {
        from_clause.push_str(
            " JOIN collection_images ci ON ci.image_id = images.id AND ci.collection_id = ?",
        );
        join_params.push(Value::Text(col_id.to_string()));
    }

    if let Some(lora) = lora_name {
        from_clause.push_str(&format!(
            " JOIN image_loras il ON il.image_id = images.id AND ({}) COLLATE NOCASE = ?",
            resource_clean_ref_sql("il.lora_name")
        ));
        join_params.push(Value::Text(lora.to_string()));
    }

    (from_clause, join_params)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_parameter_ranges(
    app: AppHandle,
    where_clause: Option<String>,
    params_json: Option<String>,
    collection_id: Option<String>,
    lora_name: Option<String>,
) -> Result<ParameterRanges, String> {
    run_blocking(app, move |conn| {
        let params: Vec<serde_json::Value> = if let Some(json) = params_json {
            serde_json::from_str(&json).unwrap_or_default()
        } else {
            Vec::new()
        };

        let sql_params: Vec<Value> = params.iter().map(|p| match p {
            serde_json::Value::String(s) => Value::Text(s.clone()),
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() { Value::Integer(i) }
                else if let Some(f) = n.as_f64() { Value::Real(f) }
                else { Value::Null }
            }
            serde_json::Value::Bool(b) => Value::Integer(if *b { 1 } else { 0 }),
            serde_json::Value::Null => Value::Null,
            _ => Value::Text(p.to_string()),
        }).collect();

        let reactive_where = where_clause.unwrap_or_else(|| "WHERE is_deleted = 0".to_string());
        let (from_clause, mut query_params) =
            build_parameter_scope_from_clause(collection_id.as_deref(), lora_name.as_deref());
        query_params.extend(sql_params);

        // Ranges
        let steps = conn.query_row("SELECT MIN(steps), MAX(steps) FROM images WHERE is_deleted = 0 AND steps > 0", [], |row| {
            let (min, max): (Option<f64>, Option<f64>) = (row.get(0).ok(), row.get(1).ok());
            Ok(match (min, max) { (Some(min), Some(max)) if min > 0.0 => Some(NumericRange { min, max }), _ => None })
        }).unwrap_or(None);

        let cfg = conn.query_row("SELECT MIN(cfg), MAX(cfg) FROM images WHERE is_deleted = 0 AND cfg > 0", [], |row| {
            let (min, max): (Option<f64>, Option<f64>) = (row.get(0).ok(), row.get(1).ok());
            Ok(match (min, max) { (Some(min), Some(max)) if min > 0.0 => Some(NumericRange { min, max }), _ => None })
        }).unwrap_or(None);

        let denoising_strength = conn.query_row("SELECT MIN(json_extract(metadata_json, '$.denoisingStrength')), MAX(json_extract(metadata_json, '$.denoisingStrength')) FROM images WHERE is_deleted = 0 AND json_extract(metadata_json, '$.denoisingStrength') IS NOT NULL", [], |row| {
            let (min, max): (Option<f64>, Option<f64>) = (row.get(0).ok(), row.get(1).ok());
            Ok(match (min, max) { (Some(min), Some(max)) => Some(NumericRange { min, max }), _ => None })
        }).unwrap_or(None);

        // Distincts
        let get_distinct = |conn: &rusqlite::Connection, field: &str| -> Result<Vec<String>, String> {
            let sql = format!("SELECT DISTINCT {} {} {} AND {} IS NOT NULL AND {} != '' AND {} != 'unknown' ORDER BY 1", field, from_clause, reactive_where, field, field, field);
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let items = stmt.query_map(rusqlite::params_from_iter(query_params.iter()), |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(items)
        };

        let samplers = get_distinct(conn, "sampler")?;
        let generation_types = get_distinct(conn, "generation_type")?;

        let get_junction_distinct = |conn: &rusqlite::Connection, table: &str, field: &str| -> Result<Vec<String>, String> {
            let sql = format!("SELECT DISTINCT {}.{} {} JOIN {} ON {}.image_id = images.id {} ORDER BY 1", table, field, from_clause, table, table, reactive_where);
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let items = stmt.query_map(rusqlite::params_from_iter(query_params.iter()), |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(items)
        };

        let control_nets = get_junction_distinct(conn, "image_controlnets", "controlnet_name")?;
        let ip_adapters = get_junction_distinct(conn, "image_ipadapters", "ipadapter_name")?;

        let mut guidance_subtypes = std::collections::HashMap::new();
        let mut stmt = conn.prepare("SELECT resource_name, guidance_subtype FROM facet_cache WHERE guidance_subtype IS NOT NULL AND guidance_subtype != ''").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<(String, String)>, _>>()
            .map_err(|e| e.to_string())?;

        for (name, subtype) in rows {
            guidance_subtypes.insert(name, subtype);
        }

        Ok(ParameterRanges { steps, cfg, denoising_strength, samplers, generation_types, control_nets, ip_adapters, guidance_subtypes })
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parameter_scope_uses_bound_values_for_collection_and_lora() {
        let collection_id = "col' OR 1=1 --";
        let lora_name = "lora' OR 1=1 --";

        let (from_clause, params) =
            build_parameter_scope_from_clause(Some(collection_id), Some(lora_name));

        assert!(from_clause.contains("ci.collection_id = ?"));
        assert!(from_clause.contains("il.lora_name"));
        assert!(from_clause.contains("COLLATE NOCASE = ?"));
        assert!(!from_clause.contains(collection_id));
        assert!(!from_clause.contains(lora_name));
        assert_eq!(
            params,
            vec![
                Value::Text(collection_id.to_string()),
                Value::Text(lora_name.to_string())
            ]
        );
    }

    #[test]
    fn seed_backfill_preserves_numeric_zero_and_rejects_ambiguous_values() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                metadata_json TEXT,
                seed INTEGER
            );

            INSERT INTO images(id, metadata_json) VALUES
                ('zero', '{"seed":0}'),
                ('known', '{"seed":123}'),
                ('missing', '{"model":"a"}'),
                ('string', '{"seed":"123"}'),
                ('malformed', '{"seed":"not-a-number"}'),
                ('bool', '{"seed":false}');
            "#,
        )
        .expect("setup seed backfill rows");

        conn.execute(
            &format!(
                "UPDATE images SET seed = {} WHERE metadata_json IS NOT NULL",
                SEED_BACKFILL_EXPRESSION
            ),
            [],
        )
        .expect("backfill seed");

        let mut stmt = conn
            .prepare("SELECT id, seed FROM images ORDER BY id")
            .expect("prepare seed query");
        let rows: Vec<(String, Option<i64>)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query seed rows")
            .collect::<Result<_, _>>()
            .expect("collect seed rows");

        assert_eq!(rows.iter().find(|row| row.0 == "zero").unwrap().1, Some(0));
        assert_eq!(rows.iter().find(|row| row.0 == "known").unwrap().1, Some(123));
        for id in ["missing", "string", "malformed", "bool"] {
            assert_eq!(
                rows.iter().find(|row| row.0 == id).unwrap().1,
                None,
                "{id} should remain unknown"
            );
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn backfill_parameter_columns(app: AppHandle) -> Result<usize, String> {
    run_blocking(app, move |conn| {
        let updated = conn.execute(
            &format!("UPDATE images SET
                steps = CAST(json_extract(metadata_json, '$.steps') AS INTEGER),
                seed = {},
                cfg = CAST(json_extract(metadata_json, '$.cfg') AS REAL),
                sampler = REPLACE(REPLACE(LOWER(json_extract(metadata_json, '$.sampler')), '_', ' '), '-', ' '),
                generation_type = json_extract(metadata_json, '$.generationType'),
                positive_prompt = COALESCE(NULLIF(json_extract(metadata_json, '$.positivePrompt'), ''), NULLIF(json_extract(metadata_json, '$.positive_prompt'), '')),
                negative_prompt = COALESCE(NULLIF(json_extract(metadata_json, '$.negativePrompt'), ''), NULLIF(json_extract(metadata_json, '$.negative_prompt'), ''))
             WHERE metadata_json IS NOT NULL", SEED_BACKFILL_EXPRESSION),
            []
        ).map_err(|e| e.to_string())?;
        let _ = conn.execute("ANALYZE images", []);
        Ok(updated)
    }).await
}

#[derive(serde::Serialize, specta::Type)]
pub struct MetadataStats {
    pub total: i64,
    pub with_raw: i64,
    pub with_pv: i64,
    pub v0: i64,
    pub v1: i64,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_metadata_stats(app: AppHandle) -> Result<MetadataStats, String> {
    run_blocking(app, move |conn| {
        let mut stmt = conn.prepare("SELECT COUNT(*), COUNT(original_metadata_json), COUNT(parser_version), SUM(CASE WHEN parser_version = 0 THEN 1 ELSE 0 END), SUM(CASE WHEN parser_version = 1 THEN 1 ELSE 0 END) FROM images WHERE is_deleted = 0").map_err(|e| e.to_string())?;
        stmt.query_row([], |row| Ok(MetadataStats {
            total: row.get(0)?, with_raw: row.get(1)?, with_pv: row.get(2)?,
            v0: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
            v1: row.get::<_, Option<i64>>(4)?.unwrap_or(0),
        })).map_err(|e| e.to_string())
    }).await
}
