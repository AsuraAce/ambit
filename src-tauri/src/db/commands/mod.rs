use rusqlite::Connection;
use tauri::AppHandle;
use super::{configure_connection, resolve_db_path};

pub mod image_commands;
pub mod maintenance;
pub mod filter_commands;
pub mod reparse_commands;

/// Standard wrapper for Tauri commands to reduce boilerplate.
/// Handles async spawn_blocking, connection setup, and error mapping.
pub async fn run_blocking<F, T>(app: AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;
        f(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}
