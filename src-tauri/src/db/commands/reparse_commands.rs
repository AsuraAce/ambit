use super::run_blocking;
use crate::db::background_work;
use crate::db::reparse::ReparseState;
use crate::metadata::{CURRENT_PARSER_VERSION, VIDEO_PARSER_VERSION};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImageToReparse {
    pub id: String,
    pub tool: String,
    pub original_metadata_json: String,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_images_needing_reparse(
    app: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<ImageToReparse>, String> {
    run_blocking(app, move |conn| {
        let limit = limit.unwrap_or(1000);
        let mut stmt = conn.prepare(&format!(
            "SELECT id, COALESCE(tool, 'Unknown'), original_metadata_json FROM scoped_images WHERE invoke_scope_hidden = 0 AND COALESCE(media_type, 'image') != 'video' AND (parser_version IS NULL OR parser_version < {}) AND is_deleted = 0 AND original_metadata_json IS NOT NULL AND original_metadata_json != '' LIMIT {}",
            CURRENT_PARSER_VERSION, limit
        )).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |row| {
            Ok(ImageToReparse {
                id: row.get(0)?,
                tool: row.get(1)?,
                original_metadata_json: row.get(2)?,
            })
        }).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

        Ok(rows)
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_reparse_count(app: AppHandle) -> Result<i64, String> {
    let paused = app.state::<ReparseState>().is_paused.clone();
    let epoch = background_work::current_epoch();
    run_blocking(app, move |conn| {
        metadata_reparse_count_unless_paused(conn, epoch, paused)
    })
    .await
}

/// The error a count returns when metadata refresh is paused while it runs. The app pauses
/// refresh during owner-cache work, and the full-library scan would compete with it (#567).
const METADATA_REFRESH_PAUSED: &str = "Metadata refresh paused";

/// Counts on `conn`, which must be the caller's own connection: the stop handler stays on it.
fn metadata_reparse_count_unless_paused(
    conn: &rusqlite::Connection,
    epoch: u64,
    paused: Arc<AtomicBool>,
) -> Result<i64, String> {
    background_work::stop_when_epoch_changes_or_job_stopped(conn, epoch, Some(paused.clone()));
    metadata_reparse_count(conn).map_err(|error| {
        let interrupted = matches!(
            error.sqlite_error_code(),
            Some(rusqlite::ErrorCode::OperationInterrupted)
        );
        if interrupted && paused.load(Ordering::SeqCst) {
            METADATA_REFRESH_PAUSED.to_string()
        } else {
            error.to_string()
        }
    })
}

fn metadata_reparse_count(conn: &rusqlite::Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM scoped_images
             WHERE is_deleted = 0 AND (
                (COALESCE(media_type, 'image') != 'video'
                    AND invoke_scope_hidden = 0
                    AND (parser_version IS NULL OR parser_version < {CURRENT_PARSER_VERSION})
                    AND original_metadata_json IS NOT NULL
                    AND original_metadata_json != '')
                OR
                (media_type = 'video'
                    AND is_missing = 0
                    AND (parser_version IS NULL OR parser_version < {VIDEO_PARSER_VERSION}))
             )"
        ),
        [],
        |row| row.get(0),
    )
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReparseBatchResult {
    pub processed: usize,
    pub updated: usize,
    pub errors: usize,
}

const REPARSE_UPDATE_SQL: &str = "UPDATE images SET metadata_json = ?1, model_hash = json_extract(?1, '$.modelHash'), model_name = json_extract(?1, '$.model'), tool = json_extract(?1, '$.tool'), resolved_model_name = COALESCE((SELECT m.name FROM models m WHERE m.hash = json_extract(?1, '$.modelHash')), json_extract(?1, '$.model')), steps = CAST(json_extract(?1, '$.steps') AS INTEGER), seed = CAST(json_extract(?1, '$.seed') AS INTEGER), cfg = CAST(json_extract(?1, '$.cfg') AS REAL), sampler = REPLACE(REPLACE(LOWER(json_extract(?1, '$.sampler')), '_', ' '), '-', ' '), generation_type = json_extract(?1, '$.generationType'), parser_version = ?2 WHERE id = ?3 AND EXISTS (SELECT 1 FROM scoped_images AS scoped WHERE scoped.id = images.id)";
const REPARSE_SKIP_SQL: &str = "UPDATE images SET parser_version = ?1 WHERE id = ?2 AND EXISTS (SELECT 1 FROM scoped_images AS scoped WHERE scoped.id = images.id)";

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn reparse_metadata_batch(
    app: AppHandle,
    images: Vec<ImageToReparse>,
) -> Result<ReparseBatchResult, String> {
    run_blocking(app, move |conn| {
        use crate::metadata::reparse::reparse_from_json;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let _hold = crate::db::write_hold::WriteHold::begin("reparse.metadata_batch");
        let mut processed = 0;
        let mut updated = 0;
        let mut errors = 0;
        {
            let mut update_stmt = tx
                .prepare_cached(REPARSE_UPDATE_SQL)
                .map_err(|e| e.to_string())?;

            for img in &images {
                processed += 1;
                match reparse_from_json(&img.original_metadata_json, &img.tool) {
                    Some(result) => {
                        if update_stmt
                            .execute(rusqlite::params![
                                result.metadata_json,
                                CURRENT_PARSER_VERSION,
                                img.id
                            ])
                            .is_ok()
                        {
                            updated += 1;
                        } else {
                            errors += 1;
                        }
                    }
                    None => {
                        let _ = tx.execute(
                            REPARSE_SKIP_SQL,
                            rusqlite::params![CURRENT_PARSER_VERSION, img.id],
                        );
                        errors += 1;
                    }
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(ReparseBatchResult {
            processed,
            updated,
            errors,
        })
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn reset_parser_versions(app: AppHandle) -> Result<usize, String> {
    let app_for_emit = app.clone();
    run_blocking(app, move |conn| {
        let total_to_reset: i64 = conn.query_row("SELECT COUNT(*) FROM scoped_images WHERE invoke_scope_hidden = 0 AND COALESCE(media_type, 'image') != 'video' AND is_deleted = 0 AND (parser_version != 0 OR parser_version IS NULL)", [], |r| r.get(0)).unwrap_or(0);
        let _ = app_for_emit.emit("reset-progress", format!("Found {} images to reset...", total_to_reset));

        let mut total_updated = 0;
        let batch_size = 1000;
        loop {
            let _ = app_for_emit.emit("reset-progress", format!("Resetting... {} / {}", total_updated, total_to_reset));
            let updated = conn.execute("UPDATE images SET parser_version = 0 WHERE id IN (SELECT id FROM scoped_images WHERE invoke_scope_hidden = 0 AND COALESCE(media_type, 'image') != 'video' AND is_deleted = 0 AND (parser_version != 0 OR parser_version IS NULL) LIMIT ?)", [batch_size]).map_err(|e| e.to_string())?;
            total_updated += updated;
            if updated == 0 { break; }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let _ = app_for_emit.emit("reset-progress", "Reset complete. Starting re-parse...".to_string());
        Ok(total_updated)
    }).await
}

#[cfg(test)]
mod tests {
    use super::{
        metadata_reparse_count, metadata_reparse_count_unless_paused, METADATA_REFRESH_PAUSED,
        REPARSE_SKIP_SQL, REPARSE_UPDATE_SQL,
    };
    use crate::metadata::{CURRENT_PARSER_VERSION, VIDEO_PARSER_VERSION};
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    fn migrated_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory database");
        for migration in crate::db::migrations::init_db() {
            conn.execute_batch(migration.sql).expect("apply migrations");
        }
        conn
    }

    // A reparse batch writes one image at a time inside one transaction. A scope check that reads
    // the whole library per image holds the write lock for minutes on a large library, and every
    // other write fails with "database is locked" behind it (#463).
    #[test]
    fn reparse_writes_read_only_the_target_row() {
        let conn = migrated_db();
        for (sql, params) in [
            (REPARSE_UPDATE_SQL, rusqlite::params!["{}", 1, "id"]),
            (REPARSE_SKIP_SQL, rusqlite::params![1, "id"]),
        ] {
            let mut stmt = conn
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("explain reparse write");
            let plan: Vec<String> = stmt
                .query_map(params, |row| row.get::<_, String>(3))
                .expect("plan rows")
                .collect::<Result<_, _>>()
                .expect("plan");
            assert!(
                !plan.iter().any(|step| step.starts_with("SCAN i")),
                "reparse write must not scan images: {plan:?}"
            );
        }
    }

    #[test]
    fn reparse_writes_skip_images_outside_the_library_scope() {
        let conn = migrated_db();
        conn.execute_batch(
            "INSERT INTO images (id, path, timestamp, invoke_scope_hidden, parser_version)
             VALUES ('visible', 'visible.png', 100, 0, 0),
                    ('hidden', 'hidden.png', 100, 1, 0);",
        )
        .expect("rows");
        for id in ["visible", "hidden"] {
            conn.execute(REPARSE_UPDATE_SQL, rusqlite::params!["{}", 5, id])
                .expect("reparse update");
        }
        let versions: Vec<(String, i64)> = conn
            .prepare("SELECT id, parser_version FROM images ORDER BY id")
            .expect("select")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("rows")
            .collect::<Result<_, _>>()
            .expect("versions");
        assert_eq!(
            versions,
            vec![("hidden".to_string(), 0), ("visible".to_string(), 5)]
        );

        for id in ["visible", "hidden"] {
            conn.execute(REPARSE_SKIP_SQL, rusqlite::params![9, id])
                .expect("reparse skip");
        }
        let hidden: i64 = conn
            .query_row(
                "SELECT parser_version FROM images WHERE id = 'hidden'",
                [],
                |row| row.get(0),
            )
            .expect("hidden version");
        assert_eq!(hidden, 0);
    }

    // The startup count scans the whole library. Run during an owner-cache build, it doubled the
    // build's facet time (#567), so the pause the app sets for that build must stop a running count.
    #[test]
    fn a_count_stops_while_metadata_refresh_is_paused_and_counts_once_resumed() {
        let conn = migrated_db();
        conn.execute_batch(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000)
             INSERT INTO images (id, path, timestamp, parser_version, original_metadata_json)
             SELECT 'img' || i, 'img' || i || '.png', 100, 0, '{\"a\":1}' FROM n;",
        )
        .expect("rows");
        // The stop epoch is process-wide, and a parallel test advances it. A count that an epoch
        // change stopped runs again in the new epoch, so only the pause decides the result.
        let count = |paused: bool| loop {
            let epoch = crate::db::background_work::current_epoch();
            let result = metadata_reparse_count_unless_paused(
                &conn,
                epoch,
                Arc::new(AtomicBool::new(paused)),
            );
            if crate::db::background_work::current_epoch() == epoch {
                break result;
            }
        };

        // The app matches this text (RUST_METADATA_REFRESH_PAUSED in useMetadataRefresh.test.tsx).
        assert_eq!(METADATA_REFRESH_PAUSED, "Metadata refresh paused");
        assert_eq!(count(true), Err(METADATA_REFRESH_PAUSED.to_string()));
        assert_eq!(count(false), Ok(5000));
    }

    #[test]
    fn combined_count_uses_independent_image_and_video_parser_versions() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory database");
        conn.execute_batch(
            "CREATE TABLE images (
                id TEXT PRIMARY KEY,
                media_type TEXT,
                parser_version INTEGER,
                invoke_scope_hidden INTEGER NOT NULL DEFAULT 0,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                is_missing INTEGER NOT NULL DEFAULT 0,
                original_metadata_json TEXT
            );
            CREATE VIEW scoped_images AS
            SELECT * FROM images WHERE invoke_scope_hidden = 0;",
        )
        .expect("schema");
        let rows = [
            (
                "stale-image",
                "image",
                CURRENT_PARSER_VERSION - 1,
                0,
                0,
                0,
                Some("{}"),
            ),
            (
                "current-image",
                "image",
                CURRENT_PARSER_VERSION,
                0,
                0,
                0,
                Some("{}"),
            ),
            (
                "hidden-image",
                "image",
                CURRENT_PARSER_VERSION - 1,
                1,
                0,
                0,
                Some("{}"),
            ),
            (
                "stale-video",
                "video",
                VIDEO_PARSER_VERSION - 1,
                0,
                0,
                0,
                None,
            ),
            (
                "current-video",
                "video",
                VIDEO_PARSER_VERSION,
                0,
                0,
                0,
                None,
            ),
            (
                "missing-video",
                "video",
                VIDEO_PARSER_VERSION - 1,
                0,
                0,
                1,
                None,
            ),
        ];
        for row in rows {
            conn.execute(
                "INSERT INTO images
                 (id, media_type, parser_version, invoke_scope_hidden, is_deleted, is_missing, original_metadata_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![row.0, row.1, row.2, row.3, row.4, row.5, row.6],
            )
            .expect("candidate row");
        }

        assert_eq!(metadata_reparse_count(&conn).expect("combined count"), 2);
    }
}
