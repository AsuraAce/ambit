use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 58: Store seed as nullable scalar metadata.
///
/// Historical zero values are ambiguous because older releases used zero for
/// both a genuine seed and missing data. Remove those derived values and let
/// parser version 4 restore a genuine zero from the untouched raw metadata.
pub fn migration58() -> Migration {
    Migration {
        version: 58,
        description: "replace_seed_zero_sentinel",
        sql: r#"
            ALTER TABLE images ADD COLUMN seed INTEGER;

            UPDATE images
            SET seed = CASE
                    WHEN json_valid(metadata_json)
                         AND json_type(metadata_json, '$.seed') IN ('integer', 'real')
                         AND CAST(json_extract(metadata_json, '$.seed') AS INTEGER) != 0
                    THEN CAST(json_extract(metadata_json, '$.seed') AS INTEGER)
                    ELSE NULL
                END,
                metadata_json = CASE
                    WHEN metadata_json IS NULL OR NOT json_valid(metadata_json) THEN metadata_json
                    WHEN json_type(metadata_json, '$.seed') IS NULL THEN metadata_json
                    WHEN json_type(metadata_json, '$.seed') IN ('integer', 'real')
                         AND CAST(json_extract(metadata_json, '$.seed') AS INTEGER) != 0
                    THEN metadata_json
                    ELSE json_remove(metadata_json, '$.seed')
                END,
                original_parsed_json = CASE
                    WHEN original_parsed_json IS NULL OR NOT json_valid(original_parsed_json) THEN original_parsed_json
                    WHEN json_type(original_parsed_json, '$.seed') IS NULL THEN original_parsed_json
                    WHEN json_type(original_parsed_json, '$.seed') IN ('integer', 'real')
                         AND CAST(json_extract(original_parsed_json, '$.seed') AS INTEGER) != 0
                    THEN original_parsed_json
                    ELSE json_remove(original_parsed_json, '$.seed')
                END;

            UPDATE removed_images
            SET metadata_json = CASE
                    WHEN metadata_json IS NULL OR NOT json_valid(metadata_json) THEN metadata_json
                    WHEN json_type(metadata_json, '$.seed') IS NULL THEN metadata_json
                    WHEN json_type(metadata_json, '$.seed') IN ('integer', 'real')
                         AND CAST(json_extract(metadata_json, '$.seed') AS INTEGER) != 0
                    THEN metadata_json
                    ELSE json_remove(metadata_json, '$.seed')
                END,
                original_parsed_json = CASE
                    WHEN original_parsed_json IS NULL OR NOT json_valid(original_parsed_json) THEN original_parsed_json
                    WHEN json_type(original_parsed_json, '$.seed') IS NULL THEN original_parsed_json
                    WHEN json_type(original_parsed_json, '$.seed') IN ('integer', 'real')
                         AND CAST(json_extract(original_parsed_json, '$.seed') AS INTEGER) != 0
                    THEN original_parsed_json
                    ELSE json_remove(original_parsed_json, '$.seed')
                END;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration58;

    #[test]
    fn migration_preserves_proven_nonzero_seeds_and_removes_ambiguous_values() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                metadata_json TEXT,
                original_metadata_json TEXT,
                original_parsed_json TEXT
            );
            CREATE TABLE removed_images (
                id TEXT PRIMARY KEY,
                metadata_json TEXT,
                original_metadata_json TEXT,
                original_parsed_json TEXT
            );

            INSERT INTO images VALUES
                ('missing', '{"model":"a"}', '{"raw":"missing"}', '{"model":"a"}'),
                ('zero', '{"seed":0,"model":"b"}', '{"rawSeed":0}', '{"seed":0,"model":"b"}'),
                ('known', '{"seed":42,"model":"c"}', '{"rawSeed":42}', '{"seed":42,"model":"c"}'),
                ('malformed', '{"seed":"not-a-number","model":"d"}', '{"rawSeed":"not-a-number"}', '{"seed":false,"model":"d"}');

            INSERT INTO removed_images VALUES
                ('removed-zero', '{"seed":0}', '{"rawSeed":0}', '{"seed":0}'),
                ('removed-known', '{"seed":7}', '{"rawSeed":7}', '{"seed":7}');
            "#,
        )
        .expect("setup schema");

        conn.execute_batch(migration58().sql)
            .expect("apply migration");

        let rows: Vec<(String, Option<i64>, String, String, String)> = conn
            .prepare(
                "SELECT id, seed, metadata_json, original_metadata_json, original_parsed_json
                 FROM images ORDER BY id",
            )
            .expect("prepare image query")
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .expect("query images")
            .collect::<Result<_, _>>()
            .expect("collect images");

        let known = rows.iter().find(|row| row.0 == "known").expect("known row");
        assert_eq!(known.1, Some(42));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&known.2).unwrap()["seed"],
            42
        );

        for id in ["missing", "zero", "malformed"] {
            let row = rows.iter().find(|row| row.0 == id).expect("image row");
            assert_eq!(row.1, None, "{id} should have an unknown scalar seed");
            assert!(
                serde_json::from_str::<serde_json::Value>(&row.2)
                    .unwrap()
                    .get("seed")
                    .is_none(),
                "{id} should not retain a derived seed"
            );
            assert!(
                serde_json::from_str::<serde_json::Value>(&row.4)
                    .unwrap()
                    .get("seed")
                    .is_none(),
                "{id} should not retain an original parsed seed"
            );
        }

        let zero = rows.iter().find(|row| row.0 == "zero").expect("zero row");
        assert_eq!(
            zero.3, r#"{"rawSeed":0}"#,
            "raw metadata must remain untouched"
        );

        let removed: Vec<(String, String, String, String)> = conn
            .prepare(
                "SELECT id, metadata_json, original_metadata_json, original_parsed_json
                 FROM removed_images ORDER BY id",
            )
            .expect("prepare removed query")
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .expect("query removed")
            .collect::<Result<_, _>>()
            .expect("collect removed");

        let removed_zero = removed
            .iter()
            .find(|row| row.0 == "removed-zero")
            .expect("removed zero");
        assert!(serde_json::from_str::<serde_json::Value>(&removed_zero.1)
            .unwrap()
            .get("seed")
            .is_none());
        assert_eq!(removed_zero.2, r#"{"rawSeed":0}"#);

        let removed_known = removed
            .iter()
            .find(|row| row.0 == "removed-known")
            .expect("removed known");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&removed_known.1).unwrap()["seed"],
            7
        );
    }
}
