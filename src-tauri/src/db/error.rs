//! Custom error types for database operations.
//! 
//! Uses `thiserror` for ergonomic error handling with automatic
//! `Display` and `Error` trait implementations.

use thiserror::Error;

/// Errors that can occur during database operations.
#[derive(Error, Debug)]
pub enum DbError {
    /// SQLite/rusqlite error
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// Database path could not be resolved
    #[error("Database path not found")]
    PathNotFound,

    /// JSON serialization/deserialization error
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// Generic error with custom message
    #[error("{0}")]
    Custom(String),
}

/// Implement conversion to String for Tauri command compatibility.
/// Tauri commands typically return `Result<T, String>`.
impl From<DbError> for String {
    fn from(err: DbError) -> Self {
        err.to_string()
    }
}

// pub type DbResult<T> = Result<T, DbError>;
