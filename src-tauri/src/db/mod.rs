use rusqlite::Connection;
use std::path::PathBuf;
use tauri::Manager;

pub mod backup;
pub mod commands;
pub mod error;
pub mod facets;
pub mod migrations;
pub mod reparse;

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
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 60000;
        PRAGMA foreign_keys = ON;
        PRAGMA cache_size = -64000;
        PRAGMA temp_store = MEMORY;
        PRAGMA mmap_size = 268435456;
    ",
    )?;
    log::info!("[DB] Applied performance PRAGMAs to rusqlite connection");
    Ok(())
}

/// One-time database initialization on app startup.
/// Opens a connection to set PERSISTENT settings like WAL mode.
pub fn init_db_connection(app: &tauri::AppHandle) -> Result<(), String> {
    let db_path = resolve_db_path(app)?;
    log::info!("[DB] Initializing database connection preferences at {:?}", db_path);

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    
    // 1. Set WAL mode (This is persistent in the DB file itself)
    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    log::info!("[DB] WAL Mode set to: {}", journal_mode);

    // 2. Set other persistent/startup-sensitive settings
    conn.execute_batch(
        "
        PRAGMA synchronous = NORMAL;
        PRAGMA mmap_size = 268435456;
        PRAGMA busy_timeout = 60000;
        ",
    ).map_err(|e| e.to_string())?;

    Ok(())
}

/// Runs PRAGMA optimize just before shutdown.
/// This updates the query planner statistics for improved performance on next launch.
pub fn optimize_on_shutdown(app: &tauri::AppHandle) -> Result<(), String> {
    let db_path = resolve_db_path(app)?;
    log::info!("[DB] Running shutdown optimization (PRAGMA optimize)...");

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    
    // 0x10002 is the recommended flag for shutdown (limit work to reasonable time)
    // and analyze tables that need it.
    match conn.execute("PRAGMA optimize(0x10002)", []) {
        Ok(_) => log::info!("[DB] Shutdown optimization complete"),
        Err(e) => log::error!("[DB] Shutdown optimization failed: {}", e),
    }

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
    /// Base64 encoded 32px WebP micro-thumbnail for instant previews
    #[serde(rename = "microThumbnail")]
    pub micro_thumbnail: Option<String>,
    /// Source of the thumbnail: 'ambit', 'invokeai', etc.
    #[serde(rename = "thumbnailSource")]
    pub thumbnail_source: Option<String>,
    #[serde(rename = "isFavorite")]
    pub is_favorite: bool,
    #[serde(rename = "isPinned")]
    pub is_pinned: bool,
    #[serde(rename = "isDeleted")]
    pub is_deleted: bool,
    #[serde(rename = "isMissing")]
    pub is_missing: bool,
    #[serde(rename = "isCorrupt")]
    pub is_corrupt: bool,
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
