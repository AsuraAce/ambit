use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tauri::Manager;

pub mod backup;
pub mod commands;
pub mod error;
pub mod facets;
pub mod migrations;
pub mod reparse;

#[cfg(any(test, all(windows, not(debug_assertions))))]
const PRODUCTION_IDENTIFIER: &str = "io.github.asuraace.ambit";
pub const MAIN_DB_FILE_NAME: &str = "images.db";
pub const LEGACY_MAIN_DB_URL: &str = "sqlite:images.db";

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
    log::info!(
        "[DB] Initializing database connection preferences at {:?}",
        db_path
    );

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
    )
    .map_err(|e| e.to_string())?;

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
    #[serde(rename = "fileHash")]
    pub file_hash: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DbPathInfo {
    pub active_path: PathBuf,
    pub local_path: PathBuf,
    pub roaming_path: PathBuf,
    pub is_using_roaming_fallback: bool,
}

#[cfg(all(windows, not(debug_assertions)))]
pub fn main_database_migration_urls() -> Vec<String> {
    production_database_migration_urls()
}

#[cfg(not(all(windows, not(debug_assertions))))]
pub fn main_database_migration_urls() -> Vec<String> {
    vec![LEGACY_MAIN_DB_URL.to_string()]
}

pub fn resolve_db_path_info(app: &tauri::AppHandle) -> Result<DbPathInfo, String> {
    let roaming_path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(MAIN_DB_FILE_NAME);
    let local_path = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join(MAIN_DB_FILE_NAME);

    let prefer_local = should_prefer_local_app_data();
    let (active_path, is_using_roaming_fallback) =
        choose_active_db_path(&local_path, &roaming_path, prefer_local);

    if let Some(parent) = active_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    Ok(DbPathInfo {
        active_path,
        local_path,
        roaming_path,
        is_using_roaming_fallback,
    })
}

pub fn resolve_main_database_url(app: &tauri::AppHandle) -> Result<String, String> {
    let info = resolve_db_path_info(app)?;
    Ok(database_url_for_active_path(
        &info.active_path,
        should_use_local_sql_url(),
    ))
}

// Helper to resolve the correct DB path used by native rusqlite maintenance commands.
pub fn resolve_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_db_path_info(app)?.active_path)
}

fn should_prefer_local_app_data() -> bool {
    cfg!(all(windows, not(debug_assertions)))
}

fn should_use_local_sql_url() -> bool {
    cfg!(all(windows, not(debug_assertions)))
}

fn choose_active_db_path(
    local_path: &Path,
    roaming_path: &Path,
    prefer_local: bool,
) -> (PathBuf, bool) {
    if prefer_local {
        if local_path.exists() {
            return (local_path.to_path_buf(), false);
        }
        if roaming_path.exists() {
            return (roaming_path.to_path_buf(), true);
        }
        return (local_path.to_path_buf(), false);
    }

    if roaming_path.exists() {
        return (roaming_path.to_path_buf(), false);
    }
    if local_path.exists() {
        return (local_path.to_path_buf(), false);
    }
    (roaming_path.to_path_buf(), false)
}

fn database_url_for_active_path(active_path: &Path, use_local_sql_url: bool) -> String {
    if !use_local_sql_url {
        return LEGACY_MAIN_DB_URL.to_string();
    }

    sqlite_url_for_path(active_path)
}

fn sqlite_url_for_path(path: &Path) -> String {
    format!("sqlite:{}", path.to_string_lossy().replace('\\', "/"))
}

#[cfg(any(test, all(windows, not(debug_assertions))))]
fn push_unique_url(urls: &mut Vec<String>, url: String) {
    if urls.iter().any(|existing| existing == &url) {
        return;
    }
    urls.push(url);
}

#[cfg(all(windows, not(debug_assertions)))]
fn production_database_migration_urls() -> Vec<String> {
    let mut urls = Vec::new();

    if let Some(local_root) = dirs::data_local_dir() {
        push_unique_url(
            &mut urls,
            sqlite_url_for_path(
                &local_root
                    .join(PRODUCTION_IDENTIFIER)
                    .join(MAIN_DB_FILE_NAME),
            ),
        );
    }

    if let Some(roaming_root) = dirs::config_dir() {
        push_unique_url(
            &mut urls,
            sqlite_url_for_path(
                &roaming_root
                    .join(PRODUCTION_IDENTIFIER)
                    .join(MAIN_DB_FILE_NAME),
            ),
        );
    }

    push_unique_url(&mut urls, LEGACY_MAIN_DB_URL.to_string());
    urls
}

#[cfg(test)]
fn production_database_migration_urls_for_roots(
    local_root: &Path,
    roaming_root: &Path,
) -> Vec<String> {
    let mut urls = Vec::new();

    push_unique_url(
        &mut urls,
        sqlite_url_for_path(
            &local_root
                .join(PRODUCTION_IDENTIFIER)
                .join(MAIN_DB_FILE_NAME),
        ),
    );
    push_unique_url(
        &mut urls,
        sqlite_url_for_path(
            &roaming_root
                .join(PRODUCTION_IDENTIFIER)
                .join(MAIN_DB_FILE_NAME),
        ),
    );
    push_unique_url(&mut urls, LEGACY_MAIN_DB_URL.to_string());
    urls
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_root(test_name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "ambit-db-path-{test_name}-{}-{timestamp}",
            std::process::id()
        ))
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("test parent directory should be created");
        }
        fs::write(path, contents).expect("test file should be written");
    }

    fn cleanup(root: &Path) {
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn local_db_is_preferred_when_requested_and_present() {
        let root = unique_temp_root("local-present");
        let local = root.join("Local").join(MAIN_DB_FILE_NAME);
        let roaming = root.join("Roaming").join(MAIN_DB_FILE_NAME);
        write_file(&local, "local");
        write_file(&roaming, "roaming");

        let (active, using_roaming_fallback) = choose_active_db_path(&local, &roaming, true);

        assert_eq!(active, local);
        assert!(!using_roaming_fallback);
        cleanup(&root);
    }

    #[test]
    fn roaming_db_is_used_only_as_local_fallback() {
        let root = unique_temp_root("roaming-fallback");
        let local = root.join("Local").join(MAIN_DB_FILE_NAME);
        let roaming = root.join("Roaming").join(MAIN_DB_FILE_NAME);
        write_file(&roaming, "roaming");

        let (active, using_roaming_fallback) = choose_active_db_path(&local, &roaming, true);

        assert_eq!(active, roaming);
        assert!(using_roaming_fallback);
        cleanup(&root);
    }

    #[test]
    fn fresh_db_defaults_to_local_when_requested() {
        let root = unique_temp_root("fresh-local");
        let local = root.join("Local").join(MAIN_DB_FILE_NAME);
        let roaming = root.join("Roaming").join(MAIN_DB_FILE_NAME);

        let (active, using_roaming_fallback) = choose_active_db_path(&local, &roaming, true);

        assert_eq!(active, local);
        assert!(!using_roaming_fallback);
        cleanup(&root);
    }

    #[test]
    fn dev_profile_defaults_to_legacy_sql_url() {
        let local_path = Path::new(
            "C:\\Users\\AmbitTester\\AppData\\Local\\io.github.asuraace.ambit\\images.db",
        );

        assert_eq!(
            database_url_for_active_path(local_path, false),
            LEGACY_MAIN_DB_URL
        );
    }

    #[test]
    fn sqlite_url_for_path_normalizes_windows_separators() {
        let local_path = Path::new(
            "C:\\Users\\AmbitTester\\AppData\\Local\\io.github.asuraace.ambit\\images.db",
        );

        assert_eq!(
            sqlite_url_for_path(local_path),
            "sqlite:C:/Users/AmbitTester/AppData/Local/io.github.asuraace.ambit/images.db"
        );
    }

    #[test]
    fn non_production_migration_urls_use_legacy_sql_url() {
        assert_eq!(
            main_database_migration_urls(),
            vec![LEGACY_MAIN_DB_URL.to_string()]
        );
    }

    #[test]
    fn production_sql_url_uses_resolved_local_path_when_local_is_active() {
        let root = unique_temp_root("production-local-url");
        let local = root
            .join("redirected-local")
            .join(PRODUCTION_IDENTIFIER)
            .join(MAIN_DB_FILE_NAME);
        write_file(&local, "local");

        assert_eq!(
            database_url_for_active_path(&local, true),
            sqlite_url_for_path(&local)
        );
        cleanup(&root);
    }

    #[test]
    fn production_sql_url_uses_resolved_roaming_path_when_roaming_is_active() {
        let root = unique_temp_root("production-roaming-url");
        let roaming = root
            .join("redirected-roaming")
            .join(PRODUCTION_IDENTIFIER)
            .join(MAIN_DB_FILE_NAME);
        write_file(&roaming, "roaming");

        assert_eq!(
            database_url_for_active_path(&roaming, true),
            sqlite_url_for_path(&roaming)
        );
        cleanup(&root);
    }

    #[test]
    fn production_sql_url_defaults_to_resolved_local_path_for_fresh_profiles() {
        let root = unique_temp_root("production-fresh-url");
        let local = root
            .join("local")
            .join(PRODUCTION_IDENTIFIER)
            .join(MAIN_DB_FILE_NAME);

        assert_eq!(
            database_url_for_active_path(&local, true),
            sqlite_url_for_path(&local)
        );
        cleanup(&root);
    }

    #[test]
    fn production_migration_urls_include_dynamic_local_roaming_and_legacy_urls() {
        let root = unique_temp_root("production-migration-urls");
        let local_root = root.join("Local");
        let roaming_root = root.join("Redirected").join("Roaming");
        let expected_local = sqlite_url_for_path(
            &local_root
                .join(PRODUCTION_IDENTIFIER)
                .join(MAIN_DB_FILE_NAME),
        );
        let expected_roaming = sqlite_url_for_path(
            &roaming_root
                .join(PRODUCTION_IDENTIFIER)
                .join(MAIN_DB_FILE_NAME),
        );

        let urls = production_database_migration_urls_for_roots(&local_root, &roaming_root);

        assert_eq!(
            urls,
            vec![expected_local, expected_roaming, LEGACY_MAIN_DB_URL.to_string()]
        );
        cleanup(&root);
    }
}
