use crate::db::{configure_connection, resolve_db_path};
use rayon::prelude::*;
use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};

use super::models::FileMetadataProbe;

pub fn verify_image_paths_impl(paths: Vec<String>) -> Vec<String> {
    paths
        .par_iter()
        .filter(|path| !Path::new(path).exists())
        .map(|path| path.clone())
        .collect()
}

pub fn get_file_sizes_bulk_impl(paths: Vec<String>) -> Vec<u64> {
    let mut sizes = Vec::with_capacity(paths.len());
    for path in paths {
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        sizes.push(size);
    }
    sizes
}

pub fn probe_file_metadata_bulk_impl(paths: Vec<String>) -> Vec<FileMetadataProbe> {
    paths
        .into_par_iter()
        .map(|path| match fs::metadata(&path) {
            Ok(metadata) => FileMetadataProbe::Present {
                size: metadata.len(),
                is_file: metadata.is_file(),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                FileMetadataProbe::Missing
            }
            Err(error) => FileMetadataProbe::Error {
                message: error.to_string(),
            },
        })
        .collect()
}

pub fn validate_metadata_probe_paths<F>(paths: &[String], mut is_allowed: F) -> Result<(), String>
where
    F: FnMut(&Path) -> bool,
{
    for path in paths {
        if path.trim().is_empty() || !is_allowed(Path::new(path)) {
            return Err(format!(
                "File metadata probe path is outside the allowed filesystem scope: {path}"
            ));
        }
    }
    Ok(())
}

/// Refuses unless every path is inside the registered filesystem scope. Only
/// each root is checked, as in `list_invokeai_images_in_scope`; what lies below
/// it is not. `label` names the path in the refusal.
pub fn validate_scoped_roots<F>(
    paths: &[String],
    mut is_allowed: F,
    label: &str,
) -> Result<(), String>
where
    F: FnMut(&Path) -> bool,
{
    for path in paths {
        if path.trim().is_empty() || !is_allowed(Path::new(path)) {
            return Err(format!(
                "{label} is outside the allowed filesystem scope: {path}"
            ));
        }
    }
    Ok(())
}

/// Refuses unless every path is inside the registered filesystem scope or is an
/// image the library already tracks. Library images can sit in folders that are
/// not registered this session, such as a folder removed from settings or an
/// earlier picked-file import. The file need not exist, so a missing library
/// image still reaches `verify_image_paths` and is reported as missing. The
/// library is consulted only for paths outside the scope. One refused path
/// refuses the whole call.
pub fn validate_library_file_paths<F, K>(
    paths: &[String],
    mut is_allowed: F,
    mut is_known_media: K,
) -> Result<(), String>
where
    F: FnMut(&Path) -> bool,
    K: FnMut(&str) -> Result<bool, String>,
{
    for path in paths {
        if path.trim().is_empty() {
            return Err("Image path cannot be empty".to_string());
        }
        if !is_allowed(Path::new(path)) && !is_known_media(path)? {
            return Err(format!(
                "Image path is outside the allowed filesystem scope and not in the library: {path}"
            ));
        }
    }
    Ok(())
}

/// Refuses a thumbnail folder other than Ambit's own `<AppLocalData>/.thumbnails`,
/// so a scan cannot write WebP files anywhere else. When both folders exist they
/// are compared after resolving links; otherwise the spelled paths must match.
pub fn validate_thumbnail_dir(dir: Option<&str>, app_thumbnail_dir: &Path) -> Result<(), String> {
    let Some(dir) = dir else {
        return Ok(());
    };
    let requested = Path::new(dir.trim());
    let same = match (
        fs::canonicalize(requested),
        fs::canonicalize(app_thumbnail_dir),
    ) {
        (Ok(requested), Ok(own)) => requested == own,
        _ => {
            !dir.trim().is_empty()
                && normalize_dir_spelling(requested) == normalize_dir_spelling(app_thumbnail_dir)
        }
    };
    if same {
        Ok(())
    } else {
        Err(format!(
            "Thumbnail folder must be Ambit's own thumbnail folder: {dir}"
        ))
    }
}

/// The spelling of `path` to check against the fs scope.
///
/// The scope canonicalizes only paths that exist, and `register_library_path` stores
/// canonical folders. A missing file under a mapped drive or a junction
/// (`Z:\Invoke` is `\\?\UNC\server\share\Invoke`) would then match no pattern, and be
/// refused instead of reported missing. A missing path is therefore spelled from its
/// nearest existing ancestor, canonicalized. A missing path containing `.` or `..` is
/// refused (`None`), so it cannot step out of that ancestor to probe what exists.
pub fn scope_check_path(
    path: &Path,
    canonicalize: impl Fn(&Path) -> std::io::Result<PathBuf>,
) -> Option<PathBuf> {
    use std::path::Component;

    if canonicalize(path).is_ok() {
        return Some(path.to_path_buf());
    }
    if path
        .components()
        .any(|part| matches!(part, Component::CurDir | Component::ParentDir))
    {
        return None;
    }
    for ancestor in path.ancestors().skip(1) {
        if ancestor.as_os_str().is_empty() {
            break;
        }
        if let Ok(base) = canonicalize(ancestor) {
            return Some(base.join(path.strip_prefix(ancestor).ok()?));
        }
    }
    Some(path.to_path_buf())
}

/// Whether the fs scope allows `path`, with a missing path spelled as
/// [`scope_check_path`] spells it. Every #384 check goes through this.
pub fn fs_scope_allows<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: &Path) -> bool {
    use tauri_plugin_fs::FsExt;
    scope_check_path(path, |candidate| fs::canonicalize(candidate))
        .is_some_and(|candidate| app.fs_scope().is_allowed(candidate))
}

fn normalize_dir_spelling(path: &Path) -> String {
    normalize_path_for_frontend(path)
        .trim_end_matches('/')
        .to_string()
}

/// Ambit's own thumbnail folder, resolved as `delete_thumbnail` resolves it.
pub fn app_thumbnail_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app local data directory: {}", e))?
        .join(".thumbnails"))
}

/// Answers whether the library tracks a path, opening the library database on
/// first use so calls whose paths are all in scope never open it.
pub struct KnownMediaLookup<'a> {
    app: &'a tauri::AppHandle,
    conn: Option<Connection>,
}

impl<'a> KnownMediaLookup<'a> {
    pub fn new(app: &'a tauri::AppHandle) -> Self {
        Self { app, conn: None }
    }

    pub fn contains(&mut self, path: &str) -> Result<bool, String> {
        if self.conn.is_none() {
            self.conn = Some(open_configured_app_db(self.app)?);
        }
        let conn = self.conn.as_ref().expect("connection opened above");
        path_is_known_media_file(conn, path, Path::new(path))
    }
}

pub fn scan_image_in_scope<F, K>(
    path: String,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
    default_tool: Option<String>,
    app_thumbnail_dir: &Path,
    is_allowed: F,
    is_known_media: K,
) -> Result<super::models::ScanResult, String>
where
    F: FnMut(&Path) -> bool,
    K: FnMut(&str) -> Result<bool, String>,
{
    validate_thumbnail_dir(thumbnail_dir.as_deref(), app_thumbnail_dir)?;
    validate_library_file_paths(std::slice::from_ref(&path), is_allowed, is_known_media)?;
    super::core::scan_image_internal(
        path,
        thumbnail_dir,
        skip_thumbnail,
        extract_workflow,
        default_tool,
    )
}

/// The checks `scan_images_bulk` runs before it reads any file.
pub fn validate_bulk_scan_request<F, K>(
    paths: &[String],
    thumbnail_dir: Option<&str>,
    app_thumbnail_dir: &Path,
    is_allowed: F,
    is_known_media: K,
) -> Result<(), String>
where
    F: FnMut(&Path) -> bool,
    K: FnMut(&str) -> Result<bool, String>,
{
    validate_thumbnail_dir(thumbnail_dir, app_thumbnail_dir)?;
    validate_library_file_paths(paths, is_allowed, is_known_media)
}

pub fn scan_image_workflow_in_scope<F, K>(
    path: String,
    is_allowed: F,
    is_known_media: K,
) -> Result<Option<String>, String>
where
    F: FnMut(&Path) -> bool,
    K: FnMut(&str) -> Result<bool, String>,
{
    validate_library_file_paths(std::slice::from_ref(&path), is_allowed, is_known_media)?;
    super::core::scan_image_workflow(path)
}

pub fn read_image_metadata_in_scope<F, K>(
    path: String,
    default_tool: Option<String>,
    is_allowed: F,
    is_known_media: K,
) -> Result<crate::metadata::ImageMetadata, String>
where
    F: FnMut(&Path) -> bool,
    K: FnMut(&str) -> Result<bool, String>,
{
    validate_library_file_paths(std::slice::from_ref(&path), is_allowed, is_known_media)?;
    super::core::read_image_metadata(path, default_tool)
}

pub fn get_file_sizes_in_scope<F, K>(
    paths: Vec<String>,
    is_allowed: F,
    is_known_media: K,
) -> Result<Vec<u64>, String>
where
    F: FnMut(&Path) -> bool,
    K: FnMut(&str) -> Result<bool, String>,
{
    validate_library_file_paths(&paths, is_allowed, is_known_media)?;
    Ok(get_file_sizes_bulk_impl(paths))
}

pub fn verify_image_paths_in_scope<F, K>(
    paths: Vec<String>,
    is_allowed: F,
    is_known_media: K,
) -> Result<Vec<String>, String>
where
    F: FnMut(&Path) -> bool,
    K: FnMut(&str) -> Result<bool, String>,
{
    validate_library_file_paths(&paths, is_allowed, is_known_media)?;
    Ok(verify_image_paths_impl(paths))
}

pub fn audit_invokeai_folder_in_scope<F>(
    path: &str,
    is_allowed: F,
) -> Result<super::models::FolderStats, String>
where
    F: FnMut(&Path) -> bool,
{
    validate_scoped_roots(&[path.to_string()], is_allowed, "InvokeAI folder")?;
    let mut stats = super::models::FolderStats::default();
    let images_path = Path::new(path).join("outputs").join("images");
    stats.directory_checked = images_path.to_string_lossy().to_string();

    if images_path.exists() && images_path.is_dir() {
        super::traversal::scan_dir_recursive(path.as_ref(), &images_path, &mut stats);
    }
    Ok(stats)
}

pub fn scan_directory_recursive_in_scope<F>(
    path: &str,
    is_allowed: F,
) -> Result<Vec<String>, String>
where
    F: FnMut(&Path) -> bool,
{
    validate_scoped_roots(&[path.to_string()], is_allowed, "Folder")?;
    let mut files = Vec::new();
    let root = Path::new(path);
    if root.exists() {
        super::traversal::collect_images_recursive_absolute(root, root, &mut files);
    }
    Ok(files)
}

pub fn scan_directory_with_stats_in_scope<F>(
    path: &str,
    is_allowed: F,
) -> Result<Vec<super::models::FileEntry>, String>
where
    F: FnMut(&Path) -> bool,
{
    validate_scoped_roots(&[path.to_string()], is_allowed, "Folder")?;
    let mut files = Vec::new();
    let root = Path::new(path);
    if root.exists() {
        super::traversal::collect_images_with_stats_recursive(root, &mut files);
    }
    Ok(files)
}

pub fn scan_directory_since_in_scope<F>(
    path: &str,
    since: u64,
    is_allowed: F,
) -> Result<Vec<super::models::FileEntry>, String>
where
    F: FnMut(&Path) -> bool,
{
    validate_scoped_roots(&[path.to_string()], is_allowed, "Folder")?;
    let mut files = Vec::new();
    let root = Path::new(path);
    if root.exists() {
        super::traversal::collect_images_with_stats_since_recursive(root, since, &mut files);
    }
    Ok(files)
}

/// Lists InvokeAI output images only when both the InvokeAI root and its
/// `outputs/images` folder are inside the registered filesystem scope. The
/// images folder is checked on its own so a link that leaves the root is refused.
pub fn list_invokeai_images_in_scope<F>(
    path: &str,
    mut is_allowed: F,
) -> Result<Vec<String>, String>
where
    F: FnMut(&Path) -> bool,
{
    let root = Path::new(path);
    if path.trim().is_empty() || !is_allowed(root) {
        return Err(format!(
            "InvokeAI folder is outside the allowed filesystem scope: {path}"
        ));
    }

    let mut files = Vec::new();
    let images_path = root.join("outputs").join("images");
    if !images_path.exists() {
        return Ok(files);
    }
    if !is_allowed(&images_path) {
        return Err(format!(
            "InvokeAI images folder is outside the allowed filesystem scope: {}",
            images_path.to_string_lossy()
        ));
    }

    super::traversal::collect_images_recursive(root, &images_path, &mut files);
    Ok(files)
}

pub fn open_file_impl(app: &tauri::AppHandle, path: String) -> Result<(), String> {
    let conn = open_configured_app_db(app)?;
    let target = resolve_known_media_file_target(&conn, &path)?;
    open_file_path(&target)
}

pub fn show_in_folder_impl(app: &tauri::AppHandle, path: String) -> Result<(), String> {
    let backup_dir = resolve_backup_dir_path(app)?;
    let (canonical_file, is_backup_file) = resolve_existing_show_target(&path, &backup_dir)?;
    if is_backup_file {
        return show_path_in_folder(&canonical_file);
    }

    let conn = open_configured_app_db(app)?;
    let target = resolve_known_media_show_target(&conn, &path, canonical_file)?;
    show_path_in_folder(&target)
}

fn open_file_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn show_path_in_folder(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent = path.parent().ok_or("No parent directory")?;
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn resolve_known_media_file_target(conn: &Connection, path: &str) -> Result<PathBuf, String> {
    let canonical_file = resolve_existing_regular_file(path)?;
    if !path_is_known_media_file(conn, path, &canonical_file)? {
        return Err("Refusing to open an untracked file".to_string());
    }

    Ok(canonical_file)
}

fn resolve_existing_regular_file(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty".to_string());
    }

    let candidate = PathBuf::from(trimmed);
    if is_filesystem_root(&candidate) {
        return Err("Refusing to open a filesystem root".to_string());
    }

    let metadata =
        fs::symlink_metadata(&candidate).map_err(|e| format!("Failed to inspect path: {}", e))?;
    if !metadata.is_file() {
        return Err("Path must be an existing regular file".to_string());
    }

    fs::canonicalize(candidate).map_err(|e| format!("Failed to resolve file path: {}", e))
}

fn is_filesystem_root(path: &Path) -> bool {
    path.parent().is_none()
}

fn open_configured_app_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    configure_connection(&conn).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn path_is_known_media_file(
    conn: &Connection,
    requested_path: &str,
    canonical_path: &Path,
) -> Result<bool, String> {
    let requested = normalize_path_string(requested_path);
    let canonical = normalize_path_for_frontend(canonical_path);

    // One EXISTS per key, so each probe can use the id or path index. A single
    // `id IN (...) OR path IN (...)` over the scoped views scanned every row, which
    // `verify_image_paths` would repeat for each path of a library-wide check.
    let is_known: i64 = conn
        .prepare_cached(
            "SELECT EXISTS(
                    SELECT 1 FROM scoped_images
                    WHERE invoke_scope_hidden = 0 AND id IN (?1, ?2)
                ) OR EXISTS(
                    SELECT 1 FROM scoped_images
                    WHERE invoke_scope_hidden = 0 AND path IN (?1, ?2)
                ) OR EXISTS(
                    SELECT 1 FROM scoped_removed_images
                    WHERE invoke_scope_hidden = 0 AND id IN (?1, ?2)
                ) OR EXISTS(
                    SELECT 1 FROM scoped_removed_images
                    WHERE invoke_scope_hidden = 0 AND path IN (?1, ?2)
                )",
        )
        .and_then(|mut statement| {
            statement.query_row(params![requested, canonical], |row| row.get(0))
        })
        .map_err(|e| e.to_string())?;

    Ok(is_known != 0)
}

fn resolve_backup_dir_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let db_path = resolve_db_path(app)?;
    let parent = db_path
        .parent()
        .ok_or_else(|| "Failed to get DB parent directory".to_string())?;

    Ok(parent.join("backups"))
}

fn is_app_backup_file(path: &Path, backup_dir: &Path) -> Result<bool, String> {
    if !path
        .extension()
        .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("db"))
    {
        return Ok(false);
    }

    let canonical_file =
        fs::canonicalize(path).map_err(|e| format!("Failed to resolve backup path: {}", e))?;
    let canonical_dir = match fs::canonicalize(backup_dir) {
        Ok(dir) => dir,
        Err(_) => return Ok(false),
    };

    Ok(canonical_file.parent() == Some(canonical_dir.as_path()))
}

fn resolve_existing_show_target(path: &str, backup_dir: &Path) -> Result<(PathBuf, bool), String> {
    let canonical_file = resolve_existing_regular_file(path)?;
    let is_backup_file = is_app_backup_file(&canonical_file, backup_dir)?;

    Ok((canonical_file, is_backup_file))
}

fn resolve_known_media_show_target(
    conn: &Connection,
    path: &str,
    canonical_file: PathBuf,
) -> Result<PathBuf, String> {
    if path_is_known_media_file(conn, path, &canonical_file)? {
        return Ok(canonical_file);
    }

    Err("Refusing to reveal an untracked file".to_string())
}

#[cfg(test)]
fn resolve_show_in_folder_target(
    conn: &Connection,
    path: &str,
    backup_dir: &Path,
) -> Result<PathBuf, String> {
    let (canonical_file, is_backup_file) = resolve_existing_show_target(path, backup_dir)?;
    if is_backup_file {
        return Ok(canonical_file);
    }

    resolve_known_media_show_target(conn, path, canonical_file)
}

fn normalize_path_for_frontend(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalize_path_string(path: &str) -> String {
    path.trim().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::{
        audit_invokeai_folder_in_scope, fs_scope_allows, get_file_sizes_in_scope,
        list_invokeai_images_in_scope, probe_file_metadata_bulk_impl, read_image_metadata_in_scope,
        resolve_existing_regular_file, resolve_existing_show_target,
        resolve_known_media_file_target, resolve_show_in_folder_target,
        scan_directory_recursive_in_scope, scan_directory_since_in_scope,
        scan_directory_with_stats_in_scope, scan_image_in_scope, scan_image_workflow_in_scope,
        scope_check_path, validate_bulk_scan_request, validate_library_file_paths,
        validate_metadata_probe_paths, validate_scoped_roots, validate_thumbnail_dir,
        verify_image_paths_in_scope,
    };
    use crate::scanner::models::FileMetadataProbe;
    use rusqlite::Connection;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn bulk_metadata_probe_distinguishes_present_paths_from_missing_paths() {
        let temp_root = temp_dir("metadata_probe");
        fs::create_dir_all(&temp_root).unwrap();
        let zero_byte = temp_root.join("zero-byte.png");
        let missing = temp_root.join("missing.png");
        let directory = temp_root.join("directory");
        fs::write(&zero_byte, []).unwrap();
        fs::create_dir(&directory).unwrap();

        let probes = probe_file_metadata_bulk_impl(vec![
            zero_byte.to_string_lossy().to_string(),
            missing.to_string_lossy().to_string(),
            directory.to_string_lossy().to_string(),
        ]);

        assert_eq!(
            probes,
            vec![
                FileMetadataProbe::Present {
                    size: 0,
                    is_file: true,
                },
                FileMetadataProbe::Missing,
                FileMetadataProbe::Present {
                    size: fs::metadata(&directory).unwrap().len(),
                    is_file: false,
                },
            ]
        );

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn bulk_metadata_probe_rejects_paths_outside_registered_scope() {
        let paths = vec![
            "D:/Library/allowed.png".to_string(),
            "C:/private/outside.png".to_string(),
        ];

        let result = validate_metadata_probe_paths(&paths, |path| {
            path.to_string_lossy().starts_with("D:/Library/")
        });

        assert_eq!(
            result,
            Err("File metadata probe path is outside the allowed filesystem scope: C:/private/outside.png".to_string())
        );
    }

    // #384: commands that walk a folder take the folder from the webview, so each
    // root must be one the user put in scope.
    #[test]
    fn scoped_roots_refuse_an_empty_or_out_of_scope_root() {
        let paths = vec!["D:/Library".to_string(), "C:/private".to_string()];
        let mut checked = Vec::new();

        let result = validate_scoped_roots(
            &paths,
            |path| {
                checked.push(path.to_path_buf());
                path.starts_with("D:/Library")
            },
            "Folder",
        );

        assert_eq!(
            result,
            Err("Folder is outside the allowed filesystem scope: C:/private".to_string())
        );
        assert_eq!(
            checked.len(),
            2,
            "every root is checked, not just the first"
        );
        assert!(validate_scoped_roots(&[" ".to_string()], |_| true, "Folder").is_err());
        assert!(validate_scoped_roots(&paths[..1], |_| true, "Folder").is_ok());
    }

    #[test]
    fn library_files_pass_when_in_scope_without_asking_the_library() {
        let paths = vec!["D:/Library/a.png".to_string()];

        let result = validate_library_file_paths(
            &paths,
            |_| true,
            |_| panic!("the library is consulted only for paths outside the scope"),
        );

        assert_eq!(result, Ok(()));
    }

    // #384: the known-media allowance keeps workflow inspection, thumbnail repair
    // and the integrity check working for library images outside this session's
    // scope, including images whose file is gone.
    #[test]
    fn library_files_outside_scope_pass_only_when_the_library_tracks_them() {
        let temp_root = temp_dir("known_media_allowance");
        fs::create_dir_all(&temp_root).unwrap();
        let tracked_missing = normalize(&temp_root.join("tracked-missing.png"));
        let removed = normalize(&temp_root.join("removed.png"));
        let untracked = normalize(&temp_root.join("untracked.png"));
        fs::write(&untracked, b"untracked").unwrap();
        let conn = media_db();
        conn.execute(
            "INSERT INTO images (id, path) VALUES (?1, ?1)",
            [&tracked_missing],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO removed_images (id, path) VALUES (?1, ?1)",
            [&removed],
        )
        .unwrap();
        let known = |path: &str| super::path_is_known_media_file(&conn, path, Path::new(path));

        assert_eq!(
            validate_library_file_paths(
                &[tracked_missing.clone(), removed.clone()],
                |_| false,
                known
            ),
            Ok(())
        );
        let refused =
            validate_library_file_paths(&[tracked_missing, untracked.clone()], |_| false, known);
        assert_eq!(
            refused,
            Err(format!(
                "Image path is outside the allowed filesystem scope and not in the library: {untracked}"
            ))
        );
        assert!(validate_library_file_paths(&["".to_string()], |_| true, known).is_err());
        assert_eq!(
            validate_library_file_paths(&[untracked], |_| false, |_| Err("db closed".to_string())),
            Err("db closed".to_string())
        );
        let _ = fs::remove_dir_all(temp_root);
    }

    // #384: a scan writes WebP thumbnails into `thumbnail_dir`, so it must be Ambit's own.
    #[test]
    fn thumbnail_dir_must_be_ambits_own() {
        let temp_root = temp_dir("thumbnail_dir");
        let own = temp_root.join(".thumbnails");
        let other = temp_root.join("other");
        fs::create_dir_all(&own).unwrap();
        fs::create_dir_all(&other).unwrap();
        let spelled = |path: &Path| path.to_string_lossy().to_string();

        assert_eq!(validate_thumbnail_dir(None, &own), Ok(()));
        assert_eq!(validate_thumbnail_dir(Some(&spelled(&own)), &own), Ok(()));
        assert_eq!(
            validate_thumbnail_dir(Some(&format!("{}/", normalize(&own))), &own),
            Ok(())
        );
        assert_eq!(
            validate_thumbnail_dir(Some(&spelled(&own.join("..").join(".thumbnails"))), &own),
            Ok(())
        );
        assert!(validate_thumbnail_dir(Some(&spelled(&other)), &own).is_err());
        assert!(
            validate_thumbnail_dir(Some(&spelled(&own.join("..").join("other"))), &own).is_err()
        );
        assert!(validate_thumbnail_dir(Some(""), &own).is_err());

        // Before Ambit's folder exists, only its exact spelling passes.
        let missing_own = temp_root.join("missing").join(".thumbnails");
        assert_eq!(
            validate_thumbnail_dir(Some(&normalize(&missing_own)), &missing_own),
            Ok(())
        );
        assert!(validate_thumbnail_dir(
            Some(&spelled(&missing_own.join("..").join("..").join("other"))),
            &missing_own
        )
        .is_err());
        let _ = fs::remove_dir_all(temp_root);
    }

    fn png_fixture(dir: &Path) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let path = dir.join("image.png");
        image::RgbImage::from_pixel(4, 4, image::Rgb([8, 16, 24]))
            .save_with_format(&path, image::ImageFormat::Png)
            .unwrap();
        path
    }

    fn webp_count(dir: &Path) -> usize {
        fs::read_dir(dir)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "webp"))
                    .count()
            })
            .unwrap_or(0)
    }

    #[test]
    fn scan_image_refuses_a_foreign_thumbnail_dir_before_writing_to_it() {
        let temp_root = temp_dir("scan_image_thumbnail_dir");
        let image = png_fixture(&temp_root.join("library"));
        let own = temp_root.join(".thumbnails");
        let foreign = temp_root.join("foreign");
        fs::create_dir_all(&foreign).unwrap();
        let scan = |thumbnail_dir: &Path| {
            scan_image_in_scope(
                image.to_string_lossy().to_string(),
                Some(thumbnail_dir.to_string_lossy().to_string()),
                false,
                false,
                None,
                &own,
                |_| true,
                |_| Ok(false),
            )
        };

        assert!(scan(&foreign)
            .err()
            .expect("a foreign thumbnail folder is refused")
            .starts_with("Thumbnail folder must be Ambit's own thumbnail folder"));
        assert_eq!(
            webp_count(&foreign),
            0,
            "nothing is written to the refused folder"
        );

        // The same scan into Ambit's own folder writes a thumbnail, so the check above
        // is what stopped the write.
        fs::create_dir_all(&own).unwrap();
        assert!(scan(&own).is_ok());
        assert_eq!(webp_count(&own), 1);
        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn per_file_commands_refuse_an_untracked_file_outside_scope() {
        let temp_root = temp_dir("per_file_scope");
        let image = png_fixture(&temp_root);
        let own = temp_root.join(".thumbnails");
        let path = image.to_string_lossy().to_string();
        let paths = vec![path.clone()];
        let outside = |result: Result<(), String>| {
            assert!(result
                .unwrap_err()
                .starts_with("Image path is outside the allowed filesystem scope"));
        };

        outside(
            scan_image_in_scope(
                path.clone(),
                None,
                true,
                false,
                None,
                &own,
                |_| false,
                |_| Ok(false),
            )
            .map(|_| ()),
        );
        outside(validate_bulk_scan_request(
            &paths,
            None,
            &own,
            |_| false,
            |_| Ok(false),
        ));
        outside(scan_image_workflow_in_scope(path.clone(), |_| false, |_| Ok(false)).map(|_| ()));
        outside(
            read_image_metadata_in_scope(path.clone(), None, |_| false, |_| Ok(false)).map(|_| ()),
        );
        outside(get_file_sizes_in_scope(paths.clone(), |_| false, |_| Ok(false)).map(|_| ()));
        // A refused path is an error, never reported back as "missing".
        outside(verify_image_paths_in_scope(paths.clone(), |_| false, |_| Ok(false)).map(|_| ()));

        // The bulk scan also refuses a foreign thumbnail folder.
        assert!(validate_bulk_scan_request(
            &paths,
            Some(&temp_root.to_string_lossy()),
            &own,
            |_| true,
            |_| Ok(true)
        )
        .is_err());

        // In scope, the same calls go through.
        assert_eq!(
            get_file_sizes_in_scope(paths.clone(), |_| true, |_| Ok(false)),
            Ok(vec![fs::metadata(&image).unwrap().len()])
        );
        let missing = temp_root.join("missing.png").to_string_lossy().to_string();
        assert_eq!(
            verify_image_paths_in_scope(vec![path, missing.clone()], |_| true, |_| Ok(false)),
            Ok(vec![missing])
        );
        let _ = fs::remove_dir_all(temp_root);
    }

    // A missing file is spelled from its nearest existing folder, canonicalized, so
    // it matches the canonical folder that registration stored.
    #[test]
    fn missing_paths_are_checked_through_their_canonical_ancestor() {
        let root = std::env::temp_dir().join("ambit_scope_check_path");
        let link = root.join("link");
        let real = root.join("real");
        let canonicalize = |path: &Path| -> std::io::Result<PathBuf> {
            if path == link {
                Ok(real.clone())
            } else if path == root || path == real || path == real.join("present.png") {
                Ok(path.to_path_buf())
            } else {
                Err(std::io::ErrorKind::NotFound.into())
            }
        };

        assert_eq!(
            scope_check_path(&link.join("gone").join("a.png"), canonicalize),
            Some(real.join("gone").join("a.png"))
        );
        // A path that exists is left for the scope to canonicalize.
        let present = real.join("present.png");
        assert_eq!(scope_check_path(&present, canonicalize), Some(present));
        // `..` cannot step out of the existing folder to probe what exists elsewhere.
        assert_eq!(
            scope_check_path(
                &link.join("gone").join("..").join("..").join("secret.png"),
                canonicalize
            ),
            None
        );
        // With no existing ancestor (an unplugged drive), the spelling is unchanged.
        let unplugged = PathBuf::from("unplugged").join("a.png");
        assert_eq!(
            scope_check_path(&unplugged, |_| Err(std::io::ErrorKind::NotFound.into())),
            Some(unplugged)
        );
    }

    // Review of #402: `verify_image_paths` refused a missing file under a junction or
    // mapped-drive root instead of reporting it missing, because the scope matched
    // the missing path literally against the root's canonical form.
    #[test]
    fn a_missing_file_under_a_linked_root_is_reported_missing_not_refused() {
        use tauri_plugin_fs::FsExt;

        let temp_root = temp_dir("linked_root");
        let real = temp_root.join("real");
        let link = temp_root.join("link");
        let outside = temp_root.join("outside");
        fs::create_dir_all(&real).unwrap();
        fs::create_dir_all(&outside).unwrap();
        #[cfg(windows)]
        {
            let status = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(&real)
                .stdout(std::process::Stdio::null())
                .status()
                .unwrap();
            assert!(status.success(), "mklink /J failed");
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle().clone();
        // As `register_library_path` registers a folder: canonical and recursive.
        handle
            .fs_scope()
            .allow_directory(fs::canonicalize(&link).unwrap(), true)
            .unwrap();

        let missing = link.join("missing.png");
        assert!(
            !handle.fs_scope().is_allowed(&missing),
            "the raw scope check no longer refuses this case; fs_scope_allows may be unneeded"
        );
        assert!(fs_scope_allows(&handle, &missing));
        assert!(!fs_scope_allows(&handle, &outside.join("missing.png")));
        assert!(!fs_scope_allows(
            &handle,
            &link.join("..").join("outside").join("missing.png")
        ));

        let missing = missing.to_string_lossy().to_string();
        assert_eq!(
            verify_image_paths_in_scope(
                vec![missing.clone()],
                |path| fs_scope_allows(&handle, path),
                |_| Ok(false)
            ),
            Ok(vec![missing])
        );

        let _ = fs::remove_dir(&link);
        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn folder_commands_refuse_a_root_outside_scope_instead_of_listing_it() {
        let temp_root = temp_dir("folder_scope");
        png_fixture(&temp_root.join("outputs").join("images"));
        let root = temp_root.to_string_lossy().to_string();
        let outside = |result: Result<(), String>| {
            assert!(result
                .unwrap_err()
                .contains("is outside the allowed filesystem scope"));
        };

        outside(scan_directory_with_stats_in_scope(&root, |_| false).map(|_| ()));
        outside(scan_directory_since_in_scope(&root, 0, |_| false).map(|_| ()));
        outside(scan_directory_recursive_in_scope(&root, |_| false).map(|_| ()));
        outside(audit_invokeai_folder_in_scope(&root, |_| false).map(|_| ()));

        assert_eq!(
            scan_directory_with_stats_in_scope(&root, |_| true)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            scan_directory_since_in_scope(&root, 0, |_| true)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            scan_directory_recursive_in_scope(&root, |_| true)
                .unwrap()
                .len(),
            1
        );
        assert!(audit_invokeai_folder_in_scope(&root, |_| true).is_ok());
        let _ = fs::remove_dir_all(temp_root);
    }

    fn invoke_fixture(name: &str) -> PathBuf {
        let root = temp_dir(name);
        let images = root.join("outputs").join("images");
        fs::create_dir_all(&images).unwrap();
        fs::write(images.join("a.png"), b"image").unwrap();
        root
    }

    // #382: a webview caller must not be able to enumerate a folder the user never approved.
    #[test]
    fn invoke_listing_refuses_a_root_outside_the_registered_scope() {
        let root = invoke_fixture("invoke_outside_scope");
        let mut checked = Vec::new();

        let result = list_invokeai_images_in_scope(&root.to_string_lossy(), |path| {
            checked.push(path.to_path_buf());
            false
        });

        assert!(result
            .unwrap_err()
            .starts_with("InvokeAI folder is outside the allowed filesystem scope"));
        assert_eq!(checked, vec![root.clone()]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn invoke_listing_refuses_an_images_folder_outside_the_registered_scope() {
        let root = invoke_fixture("invoke_images_outside_scope");
        let images = root.join("outputs").join("images");

        let result = list_invokeai_images_in_scope(&root.to_string_lossy(), |path| path != images);

        assert!(result
            .unwrap_err()
            .starts_with("InvokeAI images folder is outside the allowed filesystem scope"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn invoke_listing_refuses_an_empty_path() {
        let result = list_invokeai_images_in_scope("  ", |_| true);
        assert!(result.is_err());
    }

    #[test]
    fn invoke_listing_lists_images_inside_the_registered_scope() {
        let root = invoke_fixture("invoke_inside_scope");

        let files =
            list_invokeai_images_in_scope(&root.to_string_lossy(), |path| path.starts_with(&root))
                .unwrap();

        assert_eq!(files.len(), 1);
        assert!(files[0].ends_with("a.png"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn os_open_media_targets_require_known_regular_files() {
        let temp_root = temp_dir("media_targets");
        fs::create_dir_all(&temp_root).unwrap();
        let image = temp_root.join("image.png");
        let removed = temp_root.join("removed.png");
        let owner_hidden = temp_root.join("owner-hidden.png");
        let removed_owner_hidden = temp_root.join("removed-owner-hidden.png");
        let untracked = temp_root.join("untracked.png");
        let directory = temp_root.join("directory");
        fs::write(&image, b"image").unwrap();
        fs::write(&removed, b"removed").unwrap();
        fs::write(&owner_hidden, b"owner hidden").unwrap();
        fs::write(&removed_owner_hidden, b"removed owner hidden").unwrap();
        fs::write(&untracked, b"untracked").unwrap();
        fs::create_dir_all(&directory).unwrap();

        let conn = media_db();
        let image_path = normalize(&fs::canonicalize(&image).unwrap());
        let removed_path = normalize(&fs::canonicalize(&removed).unwrap());
        conn.execute(
            "INSERT INTO images (id, path) VALUES (?1, ?1)",
            [&image_path],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO removed_images (id, path) VALUES (?1, ?1)",
            [&removed_path],
        )
        .unwrap();
        let owner_hidden_path = normalize(&fs::canonicalize(&owner_hidden).unwrap());
        let removed_owner_hidden_path =
            normalize(&fs::canonicalize(&removed_owner_hidden).unwrap());
        conn.execute(
            "INSERT INTO images (id, path, invoke_scope_hidden) VALUES (?1, ?1, 1)",
            [&owner_hidden_path],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO removed_images (id, path, invoke_scope_hidden) VALUES (?1, ?1, 1)",
            [&removed_owner_hidden_path],
        )
        .unwrap();

        assert_eq!(
            resolve_known_media_file_target(&conn, &image.to_string_lossy()).unwrap(),
            fs::canonicalize(&image).unwrap()
        );
        assert_eq!(
            resolve_known_media_file_target(&conn, &removed.to_string_lossy()).unwrap(),
            fs::canonicalize(&removed).unwrap()
        );
        assert!(resolve_known_media_file_target(&conn, &owner_hidden.to_string_lossy()).is_err());
        assert!(
            resolve_known_media_file_target(&conn, &removed_owner_hidden.to_string_lossy())
                .is_err()
        );
        assert!(resolve_known_media_file_target(&conn, &untracked.to_string_lossy()).is_err());
        assert!(resolve_known_media_file_target(&conn, &directory.to_string_lossy()).is_err());
        assert!(resolve_known_media_file_target(&conn, "").is_err());
        assert!(resolve_known_media_file_target(
            &conn,
            &temp_root.join("missing.png").to_string_lossy()
        )
        .is_err());

        let filesystem_root = temp_root.ancestors().last().unwrap();
        assert!(resolve_existing_regular_file(&filesystem_root.to_string_lossy()).is_err());

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn show_in_folder_allows_known_media_and_direct_app_backups() {
        let temp_root = temp_dir("show_targets");
        let backup_dir = temp_root.join("backups");
        let external_dir = temp_root.join("external");
        let nested_dir = backup_dir.join("nested");
        fs::create_dir_all(&backup_dir).unwrap();
        fs::create_dir_all(&external_dir).unwrap();
        fs::create_dir_all(&nested_dir).unwrap();

        let image = temp_root.join("image.png");
        let removed = temp_root.join("removed.png");
        let backup = backup_dir.join("images.db");
        let external_backup = external_dir.join("images.db");
        let nested_backup = nested_dir.join("images.db");
        let wrong_ext_backup = backup_dir.join("images.sqlite");
        fs::write(&image, b"image").unwrap();
        fs::write(&removed, b"removed").unwrap();
        fs::write(&backup, b"backup").unwrap();
        fs::write(&external_backup, b"outside").unwrap();
        fs::write(&nested_backup, b"nested").unwrap();
        fs::write(&wrong_ext_backup, b"wrong ext").unwrap();

        let conn = media_db();
        let image_path = normalize(&fs::canonicalize(&image).unwrap());
        let removed_path = normalize(&fs::canonicalize(&removed).unwrap());
        conn.execute(
            "INSERT INTO images (id, path) VALUES (?1, ?1)",
            [&image_path],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO removed_images (id, path) VALUES (?1, ?1)",
            [&removed_path],
        )
        .unwrap();

        assert_eq!(
            resolve_show_in_folder_target(&conn, &image.to_string_lossy(), &backup_dir).unwrap(),
            fs::canonicalize(&image).unwrap()
        );
        assert_eq!(
            resolve_show_in_folder_target(&conn, &removed.to_string_lossy(), &backup_dir).unwrap(),
            fs::canonicalize(&removed).unwrap()
        );
        assert_eq!(
            resolve_show_in_folder_target(&conn, &backup.to_string_lossy(), &backup_dir).unwrap(),
            fs::canonicalize(&backup).unwrap()
        );
        assert!(resolve_show_in_folder_target(
            &conn,
            &external_backup.to_string_lossy(),
            &backup_dir
        )
        .is_err());
        assert!(resolve_show_in_folder_target(
            &conn,
            &nested_backup.to_string_lossy(),
            &backup_dir
        )
        .is_err());
        assert!(resolve_show_in_folder_target(
            &conn,
            &wrong_ext_backup.to_string_lossy(),
            &backup_dir
        )
        .is_err());

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn direct_backup_show_target_resolves_without_media_db() {
        let temp_root = temp_dir("backup_without_db");
        let backup_dir = temp_root.join("backups");
        fs::create_dir_all(&backup_dir).unwrap();
        let backup = backup_dir.join("images.db");
        fs::write(&backup, b"backup").unwrap();

        let (target, is_backup_file) =
            resolve_existing_show_target(&backup.to_string_lossy(), &backup_dir).unwrap();

        assert_eq!(target, fs::canonicalize(&backup).unwrap());
        assert!(is_backup_file);

        let _ = fs::remove_dir_all(temp_root);
    }

    fn media_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE images (id TEXT, path TEXT, invoke_scope_hidden INTEGER NOT NULL DEFAULT 0)",
            [],
        )
            .unwrap();
        conn.execute(
            "CREATE TABLE removed_images (id TEXT, path TEXT, invoke_scope_hidden INTEGER NOT NULL DEFAULT 0)",
            [],
        )
            .unwrap();
        conn.execute_batch(
            "CREATE VIEW scoped_images AS
                 SELECT * FROM images WHERE invoke_scope_hidden = 0;
             CREATE VIEW scoped_removed_images AS
                 SELECT * FROM removed_images WHERE invoke_scope_hidden = 0;",
        )
        .unwrap();
        conn
    }

    /// Opt-in timing for the known-media allowance: the integrity check sends
    /// every library path through `verify_image_paths`, and none of them may be
    /// in this session's scope. Run with
    /// `cargo test --release --lib -- --ignored --nocapture measure_known_media`.
    #[test]
    #[ignore]
    fn measure_known_media_lookup_on_a_50k_library() {
        const ROWS: usize = 50_000;
        let mut conn = Connection::open_in_memory().unwrap();
        for migration in crate::db::migrations::get_migrations() {
            conn.execute_batch(migration.sql)
                .unwrap_or_else(|e| panic!("migration {}: {e}", migration.version));
        }
        let paths: Vec<String> = (0..ROWS)
            .map(|index| format!("C:/library/generated-{index:06}.png"))
            .collect();
        let tx = conn.transaction().unwrap();
        {
            let mut insert = tx
                .prepare("INSERT INTO images (id, path, timestamp) VALUES (?1, ?1, ?2)")
                .unwrap();
            for (index, path) in paths.iter().enumerate() {
                insert
                    .execute(rusqlite::params![path, index as i64])
                    .unwrap();
            }
        }
        tx.commit().unwrap();

        let started = std::time::Instant::now();
        let result = validate_library_file_paths(
            &paths,
            |_| false,
            |path| super::path_is_known_media_file(&conn, path, Path::new(path)),
        );
        let elapsed = started.elapsed();

        assert_eq!(result, Ok(()));
        println!(
            "KNOWN_MEDIA_LOOKUP {{\"rows\":{ROWS},\"total_ms\":{:.1},\"per_path_us\":{:.2}}}",
            elapsed.as_secs_f64() * 1000.0,
            elapsed.as_secs_f64() * 1_000_000.0 / ROWS as f64
        );
    }

    fn normalize(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ambit_scanner_utils_{}_{}_{}",
            name,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}
