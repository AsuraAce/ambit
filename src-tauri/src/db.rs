use tauri_plugin_sql::{Migration, MigrationKind};
use std::path::PathBuf;
use std::collections::HashMap;
use rusqlite::params;
use tauri::Manager;

#[derive(serde::Deserialize)]
pub struct ImageRecord {
    pub id: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
    pub timestamp: u64,
    #[serde(rename = "metadataJson")]
    pub metadata_json: String,
    #[serde(rename = "thumbnailPath")]
    pub thumbnail_path: String,
    #[serde(rename = "isFavorite")]
    pub is_favorite: bool,
    #[serde(rename = "isPinned")]
    pub is_pinned: bool,
    #[serde(rename = "isDeleted")]
    pub is_deleted: bool,
    #[serde(rename = "isMissing")]
    pub is_missing: bool,
    #[serde(rename = "userMasked")]
    pub user_masked: Option<bool>,
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
    #[serde(rename = "boardId")]
    pub board_id: Option<String>,
    pub notes: Option<String>,
    #[serde(rename = "originalMetadataJson")]
    pub original_metadata_json: Option<String>,
}

pub fn init_db() -> Vec<Migration> {
    // ... migration definitions ...
    let migration = Migration {
        version: 1,
        description: "create_images_table",
        sql: "CREATE TABLE IF NOT EXISTS images (
            id TEXT PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            width INTEGER,
            height INTEGER,
            file_size INTEGER,
            timestamp INTEGER,
            metadata_json TEXT,
            thumbnail_path TEXT,
            is_favorite INTEGER DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            is_deleted INTEGER DEFAULT 0,
            is_missing INTEGER DEFAULT 0,
            user_masked INTEGER DEFAULT 0,
            group_id TEXT,
            notes TEXT,
            original_metadata_json TEXT
        );",
        kind: MigrationKind::Up,
    };

    let migration2 = Migration {
        version: 2,
        description: "add_board_id_column",
        sql: "ALTER TABLE images ADD COLUMN board_id TEXT;",
        kind: MigrationKind::Up,
    };

    let migration3 = Migration {
        version: 3,
        description: "migrate_groups_to_boards",
        sql: "UPDATE images SET board_id = group_id, group_id = NULL WHERE group_id IS NOT NULL;",
        kind: MigrationKind::Up,
    };

    let migration4 = Migration {
        version: 4,
        description: "create_collections_and_junction",
        sql: "
            CREATE TABLE IF NOT EXISTS collections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT,
                is_archived INTEGER DEFAULT 0,
                is_pinned INTEGER DEFAULT 0,
                created_at INTEGER,
                filter_state TEXT,
                manual_exclusions TEXT,
                custom_thumbnail TEXT,
                source TEXT DEFAULT 'ambit'
            );
            CREATE TABLE IF NOT EXISTS collection_images (
                collection_id TEXT,
                image_id TEXT,
                PRIMARY KEY (collection_id, image_id),
                FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
            );
            INSERT INTO collections (id, name, created_at, source)
            SELECT DISTINCT board_id, board_id, (strftime('%s', 'now') * 1000), 'invoke'
            FROM images 
            WHERE board_id IS NOT NULL;
            
            INSERT INTO collection_images (collection_id, image_id)
            SELECT board_id, id 
            FROM images 
            WHERE board_id IS NOT NULL;
        ",
        kind: MigrationKind::Up,
    };

    let migration5 = Migration {
        version: 5,
        description: "fix_timestamp_units",
        sql: "UPDATE images SET timestamp = timestamp * 1000 WHERE timestamp > 1000000000 AND timestamp < 10000000000;",
        kind: MigrationKind::Up,
    };

    let migration6 = Migration {
        version: 6,
        description: "create_models_table",
        sql: "CREATE TABLE IF NOT EXISTS models (
            hash TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            filename TEXT,
            lookup_source TEXT,
            civitai_version_id INTEGER,
            scanned_at INTEGER
        );",
        kind: MigrationKind::Up,
    };

    vec![migration, migration2, migration3, migration4, migration5, migration6]
}

// Helper to resolve the correct DB path used by tauri-plugin-sql
pub fn resolve_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(mut path) = app.path().app_config_dir() {
        path.push("images.db");
        if path.exists() {
            return Ok(path);
        }
    }

    if let Ok(mut path) = app.path().app_local_data_dir() {
        path.push("images.db");
        if path.exists() {
            return Ok(path);
        }
    }

    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    path.push("images.db");
    Ok(path)
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_images_batch(app: tauri::AppHandle, images: Vec<ImageRecord>) -> Result<usize, String> {
    let db_path = resolve_db_path(&app)?;
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

    let _ = conn.execute("PRAGMA journal_mode=WAL", []);
    let _ = conn.execute("PRAGMA synchronous=NORMAL", []);
    let _ = conn.execute("PRAGMA busy_timeout=30000", []);

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO images (id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path, is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, board_id, notes, original_metadata_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(id) DO UPDATE SET 
                path=excluded.path,
                timestamp=excluded.timestamp, 
                file_size=excluded.file_size,
                metadata_json=excluded.metadata_json,
                thumbnail_path=excluded.thumbnail_path,
                is_favorite=excluded.is_favorite,
                is_pinned=excluded.is_pinned,
                group_id=excluded.group_id,
                board_id=excluded.board_id,
                notes=excluded.notes,
                original_metadata_json=excluded.original_metadata_json"
        ).map_err(|e| e.to_string())?;

        for img in &images {
            stmt.execute(params![
                img.id,
                img.path,
                img.width,
                img.height,
                img.file_size as i64,
                img.timestamp as i64,
                img.metadata_json,
                img.thumbnail_path,
                img.is_favorite,
                img.is_pinned,
                img.is_deleted,
                img.is_missing,
                img.user_masked,
                img.group_id,
                img.board_id,
                img.notes,
                img.original_metadata_json
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(images.len())
}

#[tauri::command(rename_all = "camelCase")]
pub fn refresh_boards_native(
    app: tauri::AppHandle,
    board_mapping: HashMap<String, String>,
) -> Result<usize, String> {
    let db_path = resolve_db_path(&app)?;
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

    let _ = conn.execute("PRAGMA journal_mode=WAL", []);
    let _ = conn.execute("PRAGMA synchronous=NORMAL", []);
    let _ = conn.execute("PRAGMA busy_timeout=30000", []);

    let images_to_check: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, path FROM images WHERE board_id IS NULL")
            .map_err(|e| e.to_string())?;
        let items = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        items
    };

    if images_to_check.is_empty() {
        return Ok(0);
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut updated_count = 0;

    {
        let mut update_stmt = tx
            .prepare_cached("UPDATE images SET board_id = ?1 WHERE id = ?2")
            .map_err(|e| e.to_string())?;

        for (id, path) in images_to_check {
            let filename = path
                .split('/')
                .last()
                .or_else(|| path.split('\\').last())
                .unwrap_or(&path);

            if let Some(board_name) = board_mapping.get(filename) {
                update_stmt
                    .execute(params![board_name, id])
                    .map_err(|e| e.to_string())?;
                updated_count += 1;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(updated_count)
}
