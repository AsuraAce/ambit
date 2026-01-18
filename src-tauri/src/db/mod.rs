use std::path::PathBuf;
use tauri::Manager;
use rusqlite::Connection;

pub mod migrations;
pub mod commands;
pub mod facets;
pub mod error;
pub mod backup;


/// Apply performance-optimized PRAGMAs to a SQLite connection.
/// Should be called immediately after opening any rusqlite connection.
/// 
/// Configuration:
/// - WAL mode: Allows concurrent reads during writes
/// - synchronous=NORMAL: Good balance of safety vs speed
/// - busy_timeout=60000: Wait up to 60s for locks
/// - cache_size=-64000: 64MB cache for large libraries
/// - temp_store=MEMORY: Faster sorting and GROUP BY operations
/// - mmap_size=268435456: 256MB memory-mapped I/O
pub fn configure_connection(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 60000;
        PRAGMA foreign_keys = ON;
        PRAGMA cache_size = -64000;
        PRAGMA temp_store = MEMORY;
        PRAGMA mmap_size = 268435456;
    ")?;
    log::info!("[DB] Applied performance PRAGMAs to rusqlite connection");
    Ok(())
}

#[derive(serde::Deserialize, Clone, specta::Type)]
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
    #[serde(rename = "originalStateJson")]
    pub original_state_json: Option<String>,
}

#[derive(Clone, serde::Serialize)]
pub struct ProgressPayload {
    pub current: usize,
    pub total: usize,
    pub message: String,
}

// Helper to resolve the correct DB path used by tauri-plugin-sql
pub fn resolve_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1. Prioritize Roaming (app_config_dir/app_data_dir) - This is where 6GB db lives
    if let Ok(mut path) = app.path().app_config_dir() {
        path.push("images.db");
        if path.exists() {
            return Ok(path);
        }
    }

    // 2. Fallback to Local (app_local_data_dir)
    if let Ok(mut path) = app.path().app_local_data_dir() {
        path.push("images.db");
        if path.exists() {
            return Ok(path);
        }
    }

    // 3. Absolute default
    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    path.push("images.db");
    Ok(path)
}
