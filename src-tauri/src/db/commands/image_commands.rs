use super::run_blocking;
use crate::db::ImageRecord;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeSet;
use tauri::AppHandle;

const PRIVACY_KEYWORDS_FINGERPRINT_KEY: &str = "masked_keywords_fingerprint";
const PRIVACY_HIDDEN_CASE_SQL: &str = "CASE
    WHEN user_masked = 1 THEN 1
    WHEN user_masked = 0 THEN 0
    WHEN EXISTS (
        SELECT 1
        FROM privacy_mask_keywords k
        WHERE LOWER(COALESCE(positive_prompt, '')) LIKE '%' || k.keyword || '%'
    ) THEN 1
    ELSE 0
END";

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyMaskRefreshResult {
    pub changed: bool,
    pub updated: usize,
}

fn normalize_privacy_keywords(masked_keywords: &[String]) -> Vec<String> {
    masked_keywords
        .iter()
        .map(|keyword| keyword.trim().to_lowercase())
        .filter(|keyword| !keyword.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub fn refresh_privacy_mask_index_for_conn(
    conn: &Connection,
    masked_keywords: &[String],
) -> Result<PrivacyMaskRefreshResult, String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS privacy_mask_keywords (
            keyword TEXT PRIMARY KEY
        ) STRICT;

        CREATE TABLE IF NOT EXISTS privacy_mask_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        ) STRICT;
        ",
    )
    .map_err(|e| e.to_string())?;

    let keywords = normalize_privacy_keywords(masked_keywords);
    let fingerprint = keywords.join("\u{1f}");
    let current_fingerprint: Option<String> = conn
        .query_row(
            "SELECT value FROM privacy_mask_state WHERE key = ?1",
            [PRIVACY_KEYWORDS_FINGERPRINT_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if current_fingerprint.as_deref() == Some(fingerprint.as_str()) {
        return Ok(PrivacyMaskRefreshResult {
            changed: false,
            updated: 0,
        });
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM privacy_mask_keywords", [])
        .map_err(|e| e.to_string())?;

    {
        let mut insert_keyword = tx
            .prepare_cached("INSERT INTO privacy_mask_keywords(keyword) VALUES (?1)")
            .map_err(|e| e.to_string())?;
        for keyword in &keywords {
            insert_keyword
                .execute([keyword])
                .map_err(|e| e.to_string())?;
        }
    }

    let update_sql = format!(
        "UPDATE images
         SET privacy_hidden = {case_sql}
         WHERE privacy_hidden IS NOT ({case_sql})",
        case_sql = PRIVACY_HIDDEN_CASE_SQL
    );
    let updated = tx.execute(&update_sql, []).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO privacy_mask_state(key, value)
         VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![PRIVACY_KEYWORDS_FINGERPRINT_KEY, fingerprint],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(PrivacyMaskRefreshResult {
        changed: true,
        updated,
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn refresh_privacy_mask_index(
    app: AppHandle,
    masked_keywords: Vec<String>,
) -> Result<PrivacyMaskRefreshResult, String> {
    run_blocking(app, move |conn| {
        refresh_privacy_mask_index_for_conn(conn, &masked_keywords)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn save_images_batch(
    app: AppHandle,
    images: Vec<ImageRecord>,
) -> Result<usize, String> {
    run_blocking(app, move |conn| {
        // Retry loop for database lock issues
        let max_retries = 5;
        let mut retry_delay_ms = 100;
        
        for attempt in 0..max_retries {
            let result = (|| -> Result<usize, String> {
                let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

                {
                    use crate::metadata::CURRENT_PARSER_VERSION;
                    
                    let mut stmt = tx.prepare_cached(
                        "INSERT INTO images (id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path, micro_thumbnail, thumbnail_source, is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, board_id, notes, original_metadata_json, original_state_json, is_corrupt, model_hash, model_name, tool, resolved_model_name, steps, cfg, sampler, generation_type, parser_version, original_parsed_json, positive_prompt, negative_prompt)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21,
                             json_extract(?7, '$.modelHash'),
                             json_extract(?7, '$.model'),
                             json_extract(?7, '$.tool'),
                             COALESCE((SELECT m.name FROM models m WHERE m.hash = json_extract(?7, '$.modelHash')), json_extract(?7, '$.model')),
                             CAST(json_extract(?7, '$.steps') AS INTEGER),
                             CAST(json_extract(?7, '$.cfg') AS REAL),
                             REPLACE(REPLACE(LOWER(json_extract(?7, '$.sampler')), '_', ' '), '-', ' '),
                             json_extract(?7, '$.generationType'),
                             ?22,
                             ?7,
                             COALESCE(NULLIF(json_extract(?7, '$.positivePrompt'), ''), NULLIF(json_extract(?7, '$.positive_prompt'), '')),
                             COALESCE(NULLIF(json_extract(?7, '$.negativePrompt'), ''), NULLIF(json_extract(?7, '$.negative_prompt'), ''))
                         )
                         ON CONFLICT(id) DO UPDATE SET 
                            path=excluded.path,
                            timestamp=excluded.timestamp, 
                            file_size=excluded.file_size,
                            metadata_json=excluded.metadata_json,
                            thumbnail_path=COALESCE(NULLIF(excluded.thumbnail_path, ''), images.thumbnail_path),
                            micro_thumbnail=COALESCE(excluded.micro_thumbnail, images.micro_thumbnail),
                            thumbnail_source=COALESCE(excluded.thumbnail_source, images.thumbnail_source),
                           is_favorite=excluded.is_favorite,
                           is_pinned=excluded.is_pinned,
                           group_id=COALESCE(images.group_id, excluded.group_id),
                           board_id=excluded.board_id,
                           notes=COALESCE(images.notes, excluded.notes),
                            original_metadata_json=excluded.original_metadata_json,
                            original_state_json=COALESCE(images.original_state_json, excluded.original_state_json),
                            is_corrupt=excluded.is_corrupt,
                            model_hash=excluded.model_hash,
                            model_name=excluded.model_name,
                            tool=excluded.tool,
                            resolved_model_name=excluded.resolved_model_name,
                            steps=excluded.steps,
                            cfg=excluded.cfg,
                            sampler=excluded.sampler,
                            generation_type=excluded.generation_type,
                            parser_version=excluded.parser_version,
                            original_parsed_json=COALESCE(images.original_parsed_json, excluded.original_parsed_json),
                            positive_prompt=excluded.positive_prompt,
                            negative_prompt=excluded.negative_prompt
                         WHERE images.metadata_json != excluded.metadata_json 
                            OR images.timestamp != excluded.timestamp 
                            OR images.file_size != excluded.file_size
                            OR images.is_favorite IS NOT excluded.is_favorite
                            OR images.is_pinned IS NOT excluded.is_pinned
                            OR images.board_id IS NOT excluded.board_id
                            OR images.original_metadata_json IS NULL
                            OR images.original_metadata_json != excluded.original_metadata_json"
                    ).map_err(|e| e.to_string())?;

                    let mut lora_stmt = tx.prepare_cached("
                        INSERT OR IGNORE INTO image_loras (image_id, lora_name)
                        SELECT ?1, 
                            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                                CASE 
                                    WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                                    WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                                    ELSE value 
                                END, 
                            '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')
                        FROM json_each(?2, '$.loras')
                        WHERE value IS NOT NULL AND value != ''
                    ").map_err(|e| e.to_string())?;

                    let mut cn_stmt = tx.prepare_cached("
                        INSERT OR IGNORE INTO image_controlnets (image_id, controlnet_name)
                        SELECT ?1, 
                            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                                CASE 
                                    WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                                    WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                                    ELSE value 
                                END, 
                            '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')
                        FROM json_each(?2, '$.controlNets')
                        WHERE value IS NOT NULL AND value != ''
                    ").map_err(|e| e.to_string())?;

                    let mut ip_stmt = tx.prepare_cached("
                        INSERT OR IGNORE INTO image_ipadapters (image_id, ipadapter_name)
                        SELECT ?1, 
                            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                                CASE 
                                    WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                                    WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                                    ELSE value 
                                END, 
                            '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')
                        FROM json_each(?2, '$.ipAdapters')
                        WHERE value IS NOT NULL AND value != ''
                    ").map_err(|e| e.to_string())?;

                    let mut emb_stmt = tx.prepare_cached("
                        INSERT OR IGNORE INTO image_embeddings (image_id, embedding_name)
                        SELECT ?1, 
                            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                                CASE 
                                    WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                                    WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                                    ELSE value 
                                END, 
                            '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')
                        FROM json_each(?2, '$.embeddings')
                        WHERE value IS NOT NULL AND value != ''
                    ").map_err(|e| e.to_string())?;

                    let mut hn_stmt = tx.prepare_cached("
                        INSERT OR IGNORE INTO image_hypernetworks (image_id, hypernetwork_name)
                        SELECT ?1, 
                            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                                CASE 
                                    WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                                    WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                                    ELSE value 
                                END, 
                            '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')
                        FROM json_each(?2, '$.hypernetworks')
                        WHERE value IS NOT NULL AND value != ''
                    ").map_err(|e| e.to_string())?;

                    for img in &images {
                        let rows_affected = stmt.execute(params![
                            img.id, img.path, img.width, img.height, img.file_size as i64, img.timestamp as i64,
                            img.metadata_json, img.thumbnail_path, img.micro_thumbnail, img.thumbnail_source,
                            img.is_favorite, img.is_pinned, img.is_deleted, img.is_missing, img.user_masked,
                            img.group_id, img.board_id, img.notes, img.original_metadata_json, img.original_state_json,
                            img.is_corrupt, CURRENT_PARSER_VERSION
                        ]).map_err(|e| e.to_string())?;

                        if rows_affected > 0 {
                            lora_stmt.execute(params![img.id, img.metadata_json]).map_err(|e| e.to_string())?;
                            emb_stmt.execute(params![img.id, img.metadata_json]).map_err(|e| e.to_string())?;
                            hn_stmt.execute(params![img.id, img.metadata_json]).map_err(|e| e.to_string())?;
                            cn_stmt.execute(params![img.id, img.metadata_json]).map_err(|e| e.to_string())?;
                            ip_stmt.execute(params![img.id, img.metadata_json]).map_err(|e| e.to_string())?;
                        }
                    }
                    // Explicitly drop statements before transaction commit
                    drop(stmt);
                    drop(lora_stmt);
                    drop(cn_stmt);
                    drop(ip_stmt);
                    drop(emb_stmt);
                    drop(hn_stmt);
                }

                tx.commit().map_err(|e| e.to_string())?;
                Ok(images.len())
            })();
            
            match result {
                Ok(count) => return Ok(count),
                Err(e) if e.contains("database is locked") && attempt < max_retries - 1 => {
                    std::thread::sleep(std::time::Duration::from_millis(retry_delay_ms));
                    retry_delay_ms *= 2;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }
        Err("Failed to save images after max retries".to_string())
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_image_count_for_path_prefix(
    app: AppHandle,
    path: String,
) -> Result<i64, String> {
    run_blocking(app, move |conn| {
        let normalized = path.trim_end_matches(['/', '\\']);
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM images WHERE path LIKE ? OR path LIKE ?",
            params![format!("{}/%", normalized), format!("{}\\%", normalized)],
            |r| r.get(0),
        ).unwrap_or(0);
        Ok(count)
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn refresh_boards_native(
    app: AppHandle,
    board_mapping: std::collections::HashMap<String, String>,
) -> Result<usize, String> {
    run_blocking(app, move |conn| {
        let images_to_check: Vec<(String, String)> = {
            let mut stmt = conn.prepare("SELECT id, path FROM images WHERE board_id IS NULL").map_err(|e| e.to_string())?;
            let items = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, rusqlite::Error>>()
            .map_err(|e| e.to_string())?;
            drop(stmt);
            items
        };

        if images_to_check.is_empty() { return Ok(0); }

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut updated_count = 0;
        {
            let mut update_stmt = tx.prepare_cached("UPDATE images SET board_id = ?1 WHERE id = ?2").map_err(|e| e.to_string())?;
            for (id, path) in images_to_check {
                let filename = path.split('/').last().or_else(|| path.split('\\').last()).unwrap_or(&path);
                if let Some(board_name) = board_mapping.get(filename) {
                    update_stmt.execute(params![board_name, id]).map_err(|e| e.to_string())?;
                    updated_count += 1;
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(updated_count)
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn mark_images_corrupt(app: AppHandle, ids: Vec<String>) -> Result<usize, String> {
    run_blocking(app, move |conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut updated_count = 0;
        {
            let mut stmt = tx.prepare_cached("UPDATE images SET is_corrupt = 1, thumbnail_path = '', micro_thumbnail = NULL WHERE id = ?1").map_err(|e| e.to_string())?;
            for id in ids {
                updated_count += stmt.execute(params![id]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(updated_count)
    }).await
}

#[derive(serde::Serialize, specta::Type)]
pub struct IntegrityResult {
    pub missing: usize,
    pub recovered: usize,
    pub broken_thumbs: usize,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn verify_library_integrity(app: AppHandle) -> Result<IntegrityResult, String> {
    run_blocking(app, move |conn| {
        let images: Vec<(String, String, Option<String>)> = {
            let mut stmt = conn.prepare("SELECT id, path, thumbnail_path FROM images").map_err(|e| e.to_string())?;
            let items = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, rusqlite::Error>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            items
        };

        if images.is_empty() { return Ok(IntegrityResult { missing: 0, recovered: 0, broken_thumbs: 0 }); }

        let mut ids_to_mark_missing = Vec::new();
        let mut ids_to_mark_found = Vec::new();
        let mut ids_to_clear_thumb = Vec::new();

        for (id, path, thumb_path) in images {
            let path_exists = std::path::Path::new(&path).exists();
            if !path_exists {
                ids_to_mark_missing.push(id.clone());
            } else {
                ids_to_mark_found.push(id.clone());
                if let Some(t_path) = thumb_path {
                    if !t_path.is_empty() && !std::path::Path::new(&t_path).exists() {
                        ids_to_clear_thumb.push(id);
                    }
                }
            }
        }

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut missing_count = 0;
        let mut thumb_count = 0;
        {
            let mut missing_stmt = tx.prepare_cached("UPDATE images SET is_missing = 1 WHERE id = ?").map_err(|e| e.to_string())?;
            for id in &ids_to_mark_missing { missing_count += missing_stmt.execute(params![id]).map_err(|e| e.to_string())?; }
            
            let mut found_stmt = tx.prepare_cached("UPDATE images SET is_missing = 0 WHERE id = ?").map_err(|e| e.to_string())?;
            for id in &ids_to_mark_found { found_stmt.execute(params![id]).map_err(|e| e.to_string())?; }
            
            let mut clear_stmt = tx.prepare_cached("UPDATE images SET thumbnail_path = '', micro_thumbnail = NULL WHERE id = ?").map_err(|e| e.to_string())?;
            for id in ids_to_clear_thumb { thumb_count += clear_stmt.execute(params![id]).map_err(|e| e.to_string())?; }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(IntegrityResult { missing: missing_count, recovered: ids_to_mark_found.len(), broken_thumbs: thumb_count })
    }).await
}

#[cfg(test)]
mod tests {
    use rusqlite::{params, Connection};

    #[test]
    fn upsert_updates_live_sync_controlled_fields_even_when_metadata_is_unchanged() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                metadata_json TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                file_size INTEGER NOT NULL,
                is_favorite INTEGER,
                is_pinned INTEGER,
                board_id TEXT,
                original_metadata_json TEXT
            );
            ",
        )
        .expect("schema");

        let upsert_sql = "
            INSERT INTO images (id, metadata_json, timestamp, file_size, is_favorite, is_pinned, board_id, original_metadata_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
                metadata_json = excluded.metadata_json,
                timestamp = excluded.timestamp,
                file_size = excluded.file_size,
                is_favorite = excluded.is_favorite,
                is_pinned = excluded.is_pinned,
                board_id = excluded.board_id,
                original_metadata_json = excluded.original_metadata_json
            WHERE images.metadata_json != excluded.metadata_json
                OR images.timestamp != excluded.timestamp
                OR images.file_size != excluded.file_size
                OR images.is_favorite IS NOT excluded.is_favorite
                OR images.is_pinned IS NOT excluded.is_pinned
                OR images.board_id IS NOT excluded.board_id
                OR images.original_metadata_json IS NULL
                OR images.original_metadata_json != excluded.original_metadata_json
        ";

        conn.execute(upsert_sql, params!["img-1", "{}", 123_i64, 456_i64, 0_i64, 0_i64, Option::<String>::None, "{}"])
            .expect("initial insert");

        conn.execute(upsert_sql, params!["img-1", "{}", 123_i64, 456_i64, 1_i64, 1_i64, Some("board-1"), "{}"])
            .expect("conflict update");

        let updated = conn
            .query_row(
                "SELECT is_favorite, is_pinned, board_id FROM images WHERE id = ?1",
                ["img-1"],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .expect("fetch row");

        assert_eq!(updated.0, 1);
        assert_eq!(updated.1, 1);
        assert_eq!(updated.2.as_deref(), Some("board-1"));
    }

    #[test]
    fn refresh_privacy_mask_index_respects_manual_overrides() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                positive_prompt TEXT,
                user_masked INTEGER,
                privacy_hidden INTEGER NOT NULL DEFAULT 0
            ) STRICT;

            INSERT INTO images(id, positive_prompt, user_masked) VALUES
                ('auto-match', 'a secret landscape', NULL),
                ('manual-hidden', 'a public landscape', 1),
                ('manual-visible', 'a secret portrait', 0),
                ('auto-visible', 'a public portrait', NULL);
            ",
        )
        .expect("schema");

        let result = super::refresh_privacy_mask_index_for_conn(
            &conn,
            &["Secret".to_string(), "secret".to_string()],
        )
        .expect("refresh privacy index");

        assert!(result.changed);
        assert_eq!(result.updated, 2);

        let rows = conn
            .prepare("SELECT id, privacy_hidden FROM images ORDER BY id")
            .expect("prepare")
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
            .expect("query")
            .collect::<Result<Vec<_>, _>>()
            .expect("rows");

        assert_eq!(
            rows,
            vec![
                ("auto-match".to_string(), 1),
                ("auto-visible".to_string(), 0),
                ("manual-hidden".to_string(), 1),
                ("manual-visible".to_string(), 0),
            ]
        );

        let second = super::refresh_privacy_mask_index_for_conn(
            &conn,
            &["secret".to_string()],
        )
        .expect("second refresh");

        assert!(!second.changed);
        assert_eq!(second.updated, 0);
    }
}
