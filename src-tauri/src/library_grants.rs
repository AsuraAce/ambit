//! Folders and files the user granted Ambit, recorded by Rust (#392).
//!
//! The webview can write `library.json` and the library database, so neither can
//! say which folders the user chose. This registry can: only Rust writes it, the
//! fs capability denies it to the webview, and an entry is added only when the
//! user picks a folder or file in a native dialog opened from Rust, confirms a
//! typed folder in a native confirmation, or names a folder already inside a
//! granted one. On start Rust grants every entry again. The first start without a
//! registry seeds it once from what the previous version already granted.
//!
//! The webview cannot add a folder any other way: `register_library_path` grants
//! only a folder inside a recorded grant, and records nothing.

use crate::fs_commands::{grant_directory_scope, grant_library_directory, grant_library_file};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Manager, Runtime, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// The registry file in AppLocalData. The fs capability denies
/// `library-grants.json*` to the webview, which also covers the backup and the
/// temporary file below. Tauri matches scope globs case-insensitively, so other
/// spellings of the name are denied too.
pub const REGISTRY_FILE_NAME: &str = "library-grants.json";
const BACKUP_SUFFIX: &str = ".bak";
const TEMP_SUFFIX: &str = ".tmp";
const REGISTRY_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LibraryGrantKind {
    MonitoredFolder,
    ResourceFolder,
    InvokeAiRoot,
    A1111Root,
    /// The folder of an image or video imported on its own, before this registry.
    ImportedFolder,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FolderGrant {
    path: String,
    kind: LibraryGrantKind,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantRegistry {
    version: u32,
    /// What created the registry: the Ambit version that seeded it from the
    /// previous version's settings, or that started it empty. Seeding runs only at
    /// start, and only while neither the registry nor its backup exists.
    seeded_by: Option<String>,
    folders: Vec<FolderGrant>,
    files: Vec<String>,
    /// Where each recorded folder resolved when the start granted it, by the key
    /// of its recorded spelling. Not saved. Checks read it instead of resolving
    /// every folder on every call, which a folder on an offline network drive
    /// would stall, on the main thread for some commands (#415).
    #[serde(skip)]
    resolved: HashMap<String, String>,
}

impl GrantRegistry {
    #[cfg(test)]
    pub(crate) fn folder_count(&self) -> usize {
        self.folders.len()
    }

    /// Records a folder for `kind`. Entries of every kind accumulate, the InvokeAI
    /// and A1111 roots too: a root picked or tested in Settings is recorded before
    /// the user applies it, so the configured root must stay granted until the
    /// frontend revokes it after applying the new one.
    fn add_folder(&mut self, path: &str, kind: LibraryGrantKind) -> bool {
        let key = path_key(Path::new(path));
        if self
            .folders
            .iter()
            .any(|grant| grant.kind == kind && path_key(Path::new(&grant.path)) == key)
        {
            return false;
        }
        self.folders.push(FolderGrant {
            path: path.to_string(),
            kind,
        });
        true
    }

    fn remove_folder(&mut self, keys: &[String], kind: LibraryGrantKind) -> bool {
        let before = self.folders.len();
        self.folders.retain(|grant| {
            grant.kind != kind || !keys.contains(&path_key(Path::new(&grant.path)))
        });
        self.folders.len() != before
    }

    fn add_files(&mut self, paths: &[String]) -> bool {
        let mut keys: HashSet<String> = self
            .files
            .iter()
            .map(|file| path_key(Path::new(file)))
            .collect();
        let before = self.files.len();
        for path in paths {
            if keys.insert(path_key(Path::new(path))) {
                self.files.push(path.clone());
            }
        }
        self.files.len() != before
    }

    /// Notes where a recorded folder resolved; see [`Self::folder_keys`].
    fn remember_resolved(&mut self, recorded: &str, canonical: &Path) {
        self.resolved
            .insert(path_key(Path::new(recorded)), path_key(canonical));
    }

    /// The key each recorded folder is checked by, without touching the disk:
    /// where it resolved at the start, or its recorded spelling when it did not
    /// resolve then. A folder offline at the start is then allowed again once its
    /// drive is back, if it was recorded resolved, as every picked folder is.
    fn folder_keys(&self) -> Vec<String> {
        self.folders
            .iter()
            .map(|grant| {
                let key = path_key(Path::new(&grant.path));
                self.resolved.get(&key).cloned().unwrap_or(key)
            })
            .collect()
    }

    /// Whether `canonical` is a granted folder or lies inside one.
    fn covers(&self, canonical: &Path) -> bool {
        let key = path_key(canonical);
        self.folder_keys()
            .iter()
            .any(|root| key_is_within(&key, root))
    }
}

/// How Ambit compares paths: `\\?\` and `\\?\UNC\` prefixes removed, forward
/// slashes, no trailing separator, and case-insensitive on Windows.
pub fn path_key(path: &Path) -> String {
    path_key_with(path, cfg!(windows))
}

fn path_key_with(path: &Path, case_insensitive: bool) -> String {
    let spelled = path.to_string_lossy().replace('\\', "/");
    let spelled = if let Some(rest) = spelled.strip_prefix("//?/UNC/") {
        format!("//{rest}")
    } else if let Some(rest) = spelled.strip_prefix("//?/") {
        rest.to_string()
    } else {
        spelled
    };
    let trimmed = spelled.trim_end_matches('/');
    let trimmed = if trimmed.is_empty() && spelled.starts_with('/') {
        "/"
    } else {
        trimmed
    };
    if case_insensitive {
        trimmed.to_lowercase()
    } else {
        trimmed.to_string()
    }
}

fn key_is_within(child: &str, root: &str) -> bool {
    child == root
        || child
            .strip_prefix(root)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// A canonical path as the user should read it, without the `\\?\` prefix.
fn display_path(path: &Path) -> String {
    let spelled = path.to_string_lossy();
    if let Some(rest) = spelled.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = spelled.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        spelled.into_owned()
    }
}

/// `/`, `C:`, `//server` or a bare `//server/share`, as [`path_key`] spells them.
fn is_root_key(key: &str) -> bool {
    let bytes = key.as_bytes();
    let is_drive = bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    let is_unc_share = key
        .strip_prefix("//")
        .is_some_and(|rest| rest.split('/').filter(|part| !part.is_empty()).count() <= 2);
    key.is_empty() || key == "/" || is_drive || is_unc_share
}

/// A folder that may be recorded: not a filesystem root and not inside
/// AppLocalData, which Ambit can always read. A folder that is missing now (an
/// unplugged drive) is judged by its spelling.
fn is_recordable_folder(path: &Path, app_local_data: &Path) -> bool {
    let resolved = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let own = fs::canonicalize(app_local_data).unwrap_or_else(|_| app_local_data.to_path_buf());
    let key = path_key(&resolved);
    !is_root_key(&key) && resolved.parent().is_some() && !key_is_within(&key, &path_key(&own))
}

/// Reads and writes the registry next to its backup. A write goes to a temporary
/// file that replaces the registry, then the same content replaces the backup, so
/// a crash leaves at least one complete copy.
pub struct GrantStore {
    dir: PathBuf,
}

impl GrantStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn path(&self, suffix: &str) -> PathBuf {
        self.dir.join(format!("{REGISTRY_FILE_NAME}{suffix}"))
    }

    /// Whether the registry or its backup exists, readable or not.
    fn exists(&self) -> bool {
        self.path("").exists() || self.path(BACKUP_SUFFIX).exists()
    }

    /// Copies the registry and its backup to `*.unreadable-<seconds>`, which the
    /// capability deny still covers, so they stay for diagnosis. It copies rather
    /// than renames: the originals must stay until a readable registry replaces
    /// them, or a failed save would leave no registry and the next start would
    /// seed one from webview-written data.
    fn copy_aside(&self) {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or_default();
        for suffix in ["", BACKUP_SUFFIX] {
            let path = self.path(suffix);
            if !path.exists() {
                continue;
            }
            let aside = self.path(&format!("{suffix}.unreadable-{stamp}"));
            if let Err(error) = fs::copy(&path, &aside) {
                log::error!(
                    "[LibraryGrants] Could not copy {} aside: {error}",
                    path.display()
                );
            }
        }
    }

    /// The registry, from its backup when the main file is missing or unreadable,
    /// or `None` when neither can be read.
    pub fn load(&self) -> Option<GrantRegistry> {
        [self.path(""), self.path(BACKUP_SUFFIX)]
            .iter()
            .find_map(|path| {
                let content = fs::read_to_string(path).ok()?;
                match serde_json::from_str::<GrantRegistry>(&content) {
                    Ok(registry) => Some(registry),
                    Err(error) => {
                        log::warn!(
                            "[LibraryGrants] Ignoring unreadable {}: {error}",
                            path.display()
                        );
                        None
                    }
                }
            })
    }

    pub fn save(&self, registry: &GrantRegistry) -> Result<(), String> {
        fs::create_dir_all(&self.dir)
            .map_err(|e| format!("Failed to create the grant registry folder: {e}"))?;
        let content = serde_json::to_string_pretty(registry)
            .map_err(|e| format!("Failed to encode the grant registry: {e}"))?;
        for target in [self.path(""), self.path(BACKUP_SUFFIX)] {
            let temp = self.path(TEMP_SUFFIX);
            let mut file = fs::File::create(&temp)
                .map_err(|e| format!("Failed to write the grant registry: {e}"))?;
            file.write_all(content.as_bytes())
                .and_then(|()| file.sync_all())
                .map_err(|e| format!("Failed to write the grant registry: {e}"))?;
            drop(file);
            fs::rename(&temp, &target)
                .map_err(|e| format!("Failed to replace the grant registry: {e}"))?;
        }
        Ok(())
    }
}

/// A registry with no grants, which stops seeding: the start after a factory reset
/// must not rebuild grants from the settings the reset is about to clear.
pub(crate) fn empty_registry(created_by: &str) -> GrantRegistry {
    GrantRegistry {
        version: REGISTRY_VERSION,
        seeded_by: Some(created_by.to_string()),
        ..GrantRegistry::default()
    }
}

/// Replaces the registry in `dir` with an empty one, for a factory reset.
pub(crate) fn reset_registry(dir: &Path) -> Result<(), String> {
    GrantStore::new(dir).save(&empty_registry("factory reset"))
}

/// What the previous version granted on every start: the settings folders, and
/// the folder of each library file outside them.
pub struct PreviousGrants {
    pub folders: Vec<(String, LibraryGrantKind)>,
    pub media_paths: Vec<String>,
}

/// The registry the previous version's grants amount to. Filesystem roots and
/// folders inside AppLocalData are skipped; a media folder inside a seeded folder
/// is already covered and not recorded again.
pub fn seed_registry(
    previous: PreviousGrants,
    app_local_data: &Path,
    seeded_by: &str,
) -> GrantRegistry {
    let mut registry = empty_registry(seeded_by);
    for (path, kind) in previous.folders {
        let path = path.trim();
        if is_recordable_folder(Path::new(path), app_local_data) {
            registry.add_folder(path, kind);
        }
    }

    let resolved_key =
        |path: &Path| path_key(&fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()));
    let root_keys: Vec<String> = registry
        .folders
        .iter()
        .map(|grant| resolved_key(Path::new(&grant.path)))
        .collect();
    let mut seen = HashSet::new();
    for media_path in previous.media_paths {
        let Some(parent) = Path::new(media_path.trim()).parent() else {
            continue;
        };
        if parent.as_os_str().is_empty() || !seen.insert(path_key(parent)) {
            continue;
        }
        let key = resolved_key(parent);
        if root_keys.iter().any(|root| key_is_within(&key, root)) {
            continue;
        }
        if is_recordable_folder(parent, app_local_data) {
            registry.add_folder(&parent.to_string_lossy(), LibraryGrantKind::ImportedFolder);
        }
    }
    registry
}

/// `normalizeInvokeRoot` from `src/utils/pathUtils.ts`: an InvokeAI setting may
/// name the database file or the `databases` folder instead of the root.
fn invoke_root(raw: &str) -> Option<String> {
    let mut root = raw.trim().replace('\\', "/");
    while root.ends_with('/') {
        root.pop();
    }
    if root.to_lowercase().ends_with(".db") {
        if let Some(index) = root.rfind('/') {
            root.truncate(index);
        }
    }
    if root.to_lowercase().ends_with("/databases") {
        root.truncate(root.len() - "/databases".len());
    }
    (!root.is_empty()).then_some(root)
}

/// The folders the previous version registered from settings at start:
/// monitored folders, resource folders, the InvokeAI root and the A1111 root.
fn settings_folders(app_local_data: &Path) -> Vec<(String, LibraryGrantKind)> {
    let Some(state) = ["library.json", "library.json.bak"]
        .iter()
        .find_map(|name| {
            let content = fs::read_to_string(app_local_data.join(name)).ok()?;
            serde_json::from_str::<serde_json::Value>(&content).ok()
        })
    else {
        return Vec::new();
    };
    let settings = &state["settings"];
    let mut folders = Vec::new();
    for folder in settings["monitoredFolders"]
        .as_array()
        .into_iter()
        .flatten()
    {
        if let Some(path) = folder["path"].as_str() {
            folders.push((path.to_string(), LibraryGrantKind::MonitoredFolder));
        }
    }
    for folder in settings["resourceFolders"].as_array().into_iter().flatten() {
        if let Some(path) = folder.as_str() {
            folders.push((path.to_string(), LibraryGrantKind::ResourceFolder));
        }
    }
    if let Some(root) = settings["invokeAiPath"].as_str().and_then(invoke_root) {
        folders.push((root, LibraryGrantKind::InvokeAiRoot));
    }
    if let Some(root) = settings["a1111Path"].as_str() {
        folders.push((root.to_string(), LibraryGrantKind::A1111Root));
    }
    folders
}

fn library_media_paths(db_path: &Path) -> Vec<String> {
    let read = || -> rusqlite::Result<Vec<String>> {
        let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let mut statement = conn.prepare("SELECT path FROM images")?;
        let paths = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(paths)
    };
    if !db_path.exists() {
        return Vec::new();
    }
    // Not retried later: by then the database holds rows the new build's webview wrote.
    read().unwrap_or_else(|error| {
        log::error!("[LibraryGrants] Could not read library paths to seed grants: {error}");
        Vec::new()
    })
}

#[derive(Default)]
pub struct LibraryGrantState {
    registry: Mutex<Option<GrantRegistry>>,
    confirmation: tokio::sync::Mutex<()>,
    /// Set once the start has granted the recorded folders again. Recorded files
    /// are granted after it is set.
    restored: AtomicBool,
    restored_signal: tokio::sync::Notify,
}

impl LibraryGrantState {
    fn open_gate(&self) {
        self.restored.store(true, Ordering::SeqCst);
        self.restored_signal.notify_waiters();
    }

    /// Resolves once [`restore_grants_at_start`] has finished.
    async fn restored(&self) {
        loop {
            // Created before the check, so an `open_gate` in between still wakes it.
            let signal = self.restored_signal.notified();
            if self.restored.load(Ordering::SeqCst) {
                return;
            }
            signal.await;
        }
    }
}

/// Runs `restore` and then opens the gate, also when it fails or panics, so the
/// webview never waits forever. A failed restore leaves fewer folders readable;
/// it does not block the app.
fn open_gate_after(state: &LibraryGrantState, restore: impl FnOnce() -> Result<(), String>) {
    struct OpenOnDrop<'a>(&'a LibraryGrantState);
    impl Drop for OpenOnDrop<'_> {
        fn drop(&mut self) {
            self.0.open_gate();
        }
    }
    let _open = OpenOnDrop(state);
    if let Err(error) = restore() {
        log::error!("[LibraryGrants] Failed to restore library grants: {error}");
    }
}

fn app_local_data_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app local data directory: {e}"))
}

/// The registry Ambit starts with. Only this seeds a missing registry, from the
/// previous version's settings and library; see [`open_registry`].
pub(crate) fn startup_registry(
    app_local_data: &Path,
    db_path: &Path,
    version: &str,
) -> Result<GrantRegistry, String> {
    let seed = || {
        let previous = PreviousGrants {
            folders: settings_folders(app_local_data),
            media_paths: library_media_paths(db_path),
        };
        seed_registry(previous, app_local_data, version)
    };
    open_registry(&GrantStore::new(app_local_data), Some(&seed), version)
}

/// Loads the registry.
///
/// - A missing registry is seeded by `seed`, which only the start passes. Seeding
///   reads settings and the database, which the webview can write, so nothing a
///   command does later may trigger it.
/// - A registry that exists but cannot be read is copied aside for diagnosis and
///   replaced by an empty one. It is never reseeded.
fn open_registry(
    store: &GrantStore,
    seed: Option<&dyn Fn() -> GrantRegistry>,
    version: &str,
) -> Result<GrantRegistry, String> {
    if let Some(registry) = store.load() {
        return Ok(registry);
    }
    let registry = if store.exists() {
        log::error!(
            "[LibraryGrants] The grant registry cannot be read; keeping a copy and starting with no grants"
        );
        store.copy_aside();
        empty_registry(version)
    } else if let Some(seed) = seed {
        let registry = seed();
        log::info!(
            "[LibraryGrants] Seeded {} folder grants from the previous version",
            registry.folders.len()
        );
        registry
    } else {
        return Err("Library grants are not restored yet".to_string());
    };
    store.save(&registry)?;
    Ok(registry)
}

/// Runs `f` on the registry, loading it on first use, then saves it when `f`
/// reports a change. It never seeds: before [`restore_grants_at_start`] has run, a missing
/// registry is an error.
fn with_registry<T, R: Runtime>(
    app: &tauri::AppHandle<R>,
    f: impl FnOnce(&mut GrantRegistry) -> (T, bool),
) -> Result<T, String> {
    let store = GrantStore::new(app_local_data_dir(app)?);
    let state = app.state::<LibraryGrantState>();
    let mut guard = state
        .registry
        .lock()
        .map_err(|_| "The grant registry lock is poisoned".to_string())?;
    if guard.is_none() {
        let version = app.package_info().version.to_string();
        *guard = Some(open_registry(&store, None, &version)?);
    }
    let registry = guard.as_mut().expect("registry loaded above");
    let (value, changed) = f(registry);
    if changed {
        store.save(registry)?;
    }
    Ok(value)
}

/// What the user granted, read once for one command call. Every backend check
/// of a path the webview names goes through it (#384, #415). The fs plugin's scope
/// no longer holds library folders, so it cannot answer; and it would also hold the
/// export folders the webview picks itself.
#[derive(Debug, Default)]
pub struct LibraryAccess {
    /// Keys of the recorded folders, as [`GrantRegistry::folder_keys`] gives them.
    folders: Vec<String>,
    /// Keys of the recorded files, as recorded.
    files: HashSet<String>,
}

impl LibraryAccess {
    fn from_keys(folders: Vec<String>, files: &[String]) -> Self {
        Self {
            folders,
            files: files.iter().map(|file| path_key(Path::new(file))).collect(),
        }
    }

    /// For tests: folders resolved as the start resolves them, keeping the
    /// spelling of one that does not resolve.
    #[cfg(test)]
    pub(crate) fn new<P: AsRef<Path>>(folders: &[P], files: &[String]) -> Self {
        let keys = folders
            .iter()
            .map(|folder| {
                path_key(&fs::canonicalize(folder).unwrap_or_else(|_| folder.as_ref().into()))
            })
            .collect();
        Self::from_keys(keys, files)
    }

    /// Reads the registry once and touches no disk for the recorded folders.
    /// Before the registry can be read, nothing is allowed.
    pub fn snapshot<R: Runtime>(app: &tauri::AppHandle<R>) -> Self {
        let recorded = with_registry(app, |registry| {
            ((registry.folder_keys(), registry.files.clone()), false)
        });
        match recorded {
            Ok((folders, files)) => Self::from_keys(folders, &files),
            Err(error) => {
                log::warn!("[LibraryGrants] Allowing no library paths: {error}");
                Self::default()
            }
        }
    }

    /// The check the `*_in_scope` helpers take, from one snapshot.
    pub fn checker<R: Runtime>(app: &tauri::AppHandle<R>) -> impl Fn(&Path) -> bool {
        let access = Self::snapshot(app);
        move |path: &Path| access.allows(path)
    }

    /// Whether `path` is a recorded file or lies in a recorded folder. A missing
    /// path is judged from its nearest existing folder, as
    /// [`scope_check_path`](crate::scanner::utils::scope_check_path) spells it, so a
    /// missing file under a junction is reported missing rather than refused.
    pub fn allows(&self, path: &Path) -> bool {
        let Some(candidate) =
            crate::scanner::utils::scope_check_path(path, |p| fs::canonicalize(p))
        else {
            return false;
        };
        let resolved = fs::canonicalize(&candidate).unwrap_or(candidate);
        let key = path_key(&resolved);
        self.folders.iter().any(|root| key_is_within(&key, root))
            || self.files.contains(&key)
            || self.files.contains(&path_key(path))
    }
}

/// Grants every recorded folder again and returns the recorded files, which
/// [`restore_grants_at_start`] grants after opening the gate. Runs once at start,
/// off the main thread, because a folder on an offline network drive can take long
/// to resolve.
fn restore_folder_grants(app: &tauri::AppHandle<Wry>) -> Result<Vec<String>, String> {
    let app_local_data = app_local_data_dir(app)?;
    let db_path = crate::db::resolve_db_path(app)?;
    let (folders, files) = {
        let state = app.state::<LibraryGrantState>();
        let mut guard = state
            .registry
            .lock()
            .map_err(|_| "The grant registry lock is poisoned".to_string())?;
        if guard.is_none() {
            let version = app.package_info().version.to_string();
            *guard = Some(startup_registry(&app_local_data, &db_path, &version)?);
        }
        let registry = guard.as_ref().expect("registry loaded above");
        (registry.folders.clone(), registry.files.clone())
    };
    let mut resolved = Vec::new();
    for grant in folders {
        match grant_library_directory(app, &grant.path) {
            Ok(canonical) => resolved.push((grant.path, canonical)),
            Err(error) => log::info!("[LibraryGrants] Not granting {}: {error}", grant.path),
        }
    }
    with_registry(app, |registry| {
        for (recorded, canonical) in &resolved {
            registry.remember_resolved(recorded, canonical);
        }
        ((), false)
    })?;
    Ok(files)
}

/// The start's restore. It grants the recorded folders, then opens the gate that
/// [`wait_for_library_grants`] and `register_library_path` wait on, then grants the
/// recorded files. Files come after the gate because each is checked on disk and
/// there can be thousands, some on drives that are offline; the app should not
/// stay blank meanwhile. Their images load once their file is granted.
pub fn restore_grants_at_start(app: &tauri::AppHandle<Wry>) {
    let mut files = Vec::new();
    open_gate_after(&app.state::<LibraryGrantState>(), || {
        files = restore_folder_grants(app)?;
        Ok(())
    });
    for file in files {
        if let Err(error) = grant_library_file(app, &file) {
            log::info!("[LibraryGrants] Not granting {file}: {error}");
        }
    }
}

/// Resolves once the start has granted the recorded folders again, whether or not
/// that succeeded; recorded files are granted just after. The webview awaits it
/// before it shows the library, because it no longer registers settings folders
/// itself.
#[tauri::command]
#[specta::specta]
pub async fn wait_for_library_grants(app: tauri::AppHandle<Wry>) -> Result<(), String> {
    app.state::<LibraryGrantState>().restored().await;
    Ok(())
}

/// Grants `path` and records its canonical spelling, so the entry always names the
/// folder the user approved, whatever the working directory is at a later start.
fn record_folder(
    app: &tauri::AppHandle<Wry>,
    path: &str,
    kind: LibraryGrantKind,
) -> Result<(), String> {
    let recorded = display_path(&grant_library_directory(app, path)?);
    with_registry(app, |registry| ((), registry.add_folder(&recorded, kind)))
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|error| error.to_string())?
}

/// Opens a native folder picker and records the picked folder. Returns the
/// folder as the dialog spells it, or `None` when the user cancels.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn pick_library_folder(
    app: tauri::AppHandle<Wry>,
    window: tauri::Window<Wry>,
    kind: LibraryGrantKind,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_parent(&window);
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    dialog.pick_folder(move |picked| {
        let _ = sender.send(picked);
    });
    let Some(picked) = receiver
        .await
        .map_err(|_| "The folder dialog closed unexpectedly".to_string())?
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| format!("Unsupported folder: {e}"))?
        .to_string_lossy()
        .into_owned();
    let recorded = path.clone();
    blocking(move || record_folder(&app, &recorded, kind)).await?;
    Ok(Some(path))
}

/// Opens a native multi-file picker and records each picked file. Returns the
/// files, or none when the user cancels.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn pick_library_files(
    app: tauri::AppHandle<Wry>,
    window: tauri::Window<Wry>,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Vec<String>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
    app.dialog()
        .file()
        .set_parent(&window)
        .add_filter(filter_name, &extensions)
        .pick_files(move |picked| {
            let _ = sender.send(picked);
        });
    let picked = receiver
        .await
        .map_err(|_| "The file dialog closed unexpectedly".to_string())?
        .unwrap_or_default();
    let paths = picked
        .into_iter()
        .filter_map(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    let recorded = paths.clone();
    blocking(move || {
        let granted = grant_picked_files(&app, &recorded);
        with_registry(&app, |registry| ((), registry.add_files(&granted)))
    })
    .await?;
    Ok(paths)
}

/// Grants each picked file and returns what to record: the file as resolved.
/// Import and playback check a file's canonical path, so the record must match
/// it however the dialog spelled the file (a junction, a mapped drive, an 8.3
/// name).
fn grant_picked_files<R: Runtime>(app: &tauri::AppHandle<R>, paths: &[String]) -> Vec<String> {
    let mut granted = Vec::new();
    for path in paths {
        match grant_library_file(app, path) {
            Ok(file) => granted.push(display_path(&file)),
            Err(error) => log::warn!("[LibraryGrants] Not granting {path}: {error}"),
        }
    }
    granted
}

#[derive(Debug, PartialEq, Eq)]
enum FolderRequest {
    /// Inside AppLocalData, which Ambit can always read; nothing to record.
    AlwaysReadable,
    /// Inside a folder the user already granted; recorded without asking.
    Covered,
    /// Anything else; recorded only after the user allows it.
    NeedsConfirmation,
}

fn classify_folder_request(
    registry: &GrantRegistry,
    canonical: &Path,
    app_local_data: &Path,
) -> FolderRequest {
    if !is_recordable_folder(canonical, app_local_data) {
        FolderRequest::AlwaysReadable
    } else if registry.covers(canonical) {
        FolderRequest::Covered
    } else {
        FolderRequest::NeedsConfirmation
    }
}

/// What `register_library_path` may grant for a folder the webview names: the
/// resolved folder when a recorded grant covers it, nothing when it lies inside
/// AppLocalData, which is always readable, and an error for anything else.
fn folder_to_grant(
    registry: &GrantRegistry,
    canonical: PathBuf,
    app_local_data: &Path,
) -> Result<Option<PathBuf>, String> {
    match classify_folder_request(registry, &canonical, app_local_data) {
        FolderRequest::AlwaysReadable => Ok(None),
        FolderRequest::Covered => Ok(Some(canonical)),
        FolderRequest::NeedsConfirmation => Err(format!(
            "Ambit has no grant for {}; add it in Settings first",
            display_path(&canonical)
        )),
    }
}

/// Grants a folder the webview names, such as a monitored folder before a scan,
/// only when the user already granted it or a folder around it. It records
/// nothing. It waits for the start's restore, so the answer reflects every
/// recorded grant, including a folder on a drive that came back since.
pub(crate) async fn grant_folder_inside_grants<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<(), String> {
    app.state::<LibraryGrantState>().restored().await;
    blocking(move || {
        let canonical = crate::fs_commands::validate_library_scope_directory(&path)?;
        let app_local_data = app_local_data_dir(&app)?;
        let granted = with_registry(&app, |registry| {
            (folder_to_grant(registry, canonical, &app_local_data), false)
        })??;
        match granted {
            Some(folder) => grant_directory_scope(&app, &folder),
            None => Ok(()),
        }
    })
    .await
}

/// Resolves `path` and classifies it; a covered folder is recorded on the way.
/// Returns the canonical folder as the user should read it.
fn resolve_folder_request(
    app: &tauri::AppHandle<Wry>,
    path: &str,
    kind: LibraryGrantKind,
) -> Result<(FolderRequest, String), String> {
    let canonical = crate::fs_commands::validate_library_scope_directory(path)?;
    let app_local_data = app_local_data_dir(app)?;
    let request = with_registry(app, |registry| {
        (
            classify_folder_request(registry, &canonical, &app_local_data),
            false,
        )
    })?;
    let shown = display_path(&canonical);
    if request == FolderRequest::Covered {
        record_folder(app, &shown, kind)?;
    }
    Ok((request, shown))
}

/// Records a folder the webview names, such as one typed in Settings. A folder
/// already granted, or inside a granted folder or AppLocalData, is recorded
/// without asking; any other folder needs the user's native confirmation, which
/// shows its resolved path. The registry records that resolved path, never the
/// spelling the webview sent. Returns whether the folder is now granted.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn request_library_folder_grant(
    app: tauri::AppHandle<Wry>,
    window: tauri::Window<Wry>,
    path: String,
    kind: LibraryGrantKind,
) -> Result<bool, String> {
    let check_app = app.clone();
    let (request, shown) =
        blocking(move || resolve_folder_request(&check_app, &path, kind)).await?;
    if request != FolderRequest::NeedsConfirmation {
        return Ok(true);
    }

    // One confirmation at a time, so a burst of requests cannot stack dialogs.
    // A request that waited may have been granted meanwhile, so classify again.
    let state = app.state::<LibraryGrantState>();
    let _confirmation = state.confirmation.lock().await;
    let check_app = app.clone();
    let (request, shown) =
        blocking(move || resolve_folder_request(&check_app, &shown, kind)).await?;
    if request != FolderRequest::NeedsConfirmation {
        return Ok(true);
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!(
            "Allow Ambit to read this folder and everything inside it?

{shown}"
        ))
        .title("Allow folder access")
        .kind(MessageDialogKind::Warning)
        .parent(&window)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Allow".to_string(),
            "Cancel".to_string(),
        ))
        .show(move |allowed| {
            let _ = sender.send(allowed);
        });
    let allowed = receiver.await.unwrap_or(false);
    if !allowed {
        return Ok(false);
    }
    let record_app = app.clone();
    blocking(move || record_folder(&record_app, &shown, kind)).await?;
    Ok(true)
}

/// The registry keys a revoke of `path` removes: its spelling and, when it
/// exists, its resolved folder. `None` when `replacement`, the folder that takes
/// its place, is the same folder however either is spelled: revoking then would
/// drop the grant the user just gave.
fn revocation_keys(path: &str, replacement: Option<&str>) -> Option<Vec<String>> {
    let keys_of = |path: &str| {
        let mut keys = vec![path_key(Path::new(path.trim()))];
        if let Ok(canonical) = fs::canonicalize(path.trim()) {
            keys.push(path_key(&canonical));
        }
        keys
    };
    let keys = keys_of(path);
    match replacement {
        Some(replacement) if keys_of(replacement).iter().any(|key| keys.contains(key)) => None,
        _ => Some(keys),
    }
}

/// Removes a folder grant of `kind`, for example when the user removes a
/// monitored folder, or applies a new InvokeAI or A1111 root (`replacement`).
/// Nothing is removed when `replacement` is the same folder as `path`. The folder
/// stays readable until the next start, because a scope cannot be narrowed at
/// runtime.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn revoke_library_grant(
    app: tauri::AppHandle<Wry>,
    path: String,
    kind: LibraryGrantKind,
    replacement: Option<String>,
) -> Result<(), String> {
    blocking(move || {
        let Some(keys) = revocation_keys(&path, replacement.as_deref()) else {
            return Ok(());
        };
        with_registry(&app, |registry| ((), registry.remove_folder(&keys, kind)))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ambit-library-grants-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn folder_paths(registry: &GrantRegistry, kind: LibraryGrantKind) -> Vec<String> {
        registry
            .folders
            .iter()
            .filter(|grant| grant.kind == kind)
            .map(|grant| grant.path.clone())
            .collect()
    }

    #[test]
    fn path_keys_ignore_verbatim_prefixes_separators_and_trailing_slashes() {
        let key = |path: &str| path_key_with(Path::new(path), false);
        assert_eq!(key(r"\\?\C:\Images\Set"), "C:/Images/Set");
        assert_eq!(key(r"C:\Images\Set\"), "C:/Images/Set");
        assert_eq!(key("C:/Images/Set//"), "C:/Images/Set");
        assert_eq!(key(r"\\?\UNC\server\share\Set"), "//server/share/Set");
        assert_eq!(key(r"\\server\share\Set\"), "//server/share/Set");
        assert_eq!(key("/"), "/");
    }

    #[test]
    fn path_keys_compare_case_insensitively_where_the_filesystem_does() {
        assert_eq!(
            path_key_with(Path::new(r"\\?\C:\Images\SET"), true),
            path_key_with(Path::new("c:/images/set/"), true)
        );
        assert_ne!(
            path_key_with(Path::new("/images/SET"), false),
            path_key_with(Path::new("/images/set"), false)
        );
        assert_eq!(
            path_key(Path::new("C:/A")) == path_key(Path::new("c:/a")),
            cfg!(windows)
        );
    }

    #[test]
    fn filesystem_roots_and_bare_shares_are_roots() {
        for root in ["", "/", "C:", "c:", "//server", "//server/share"] {
            assert!(is_root_key(root), "{root:?} is a root");
        }
        for folder in ["C:/Images", "//server/share/Images", "/home/images"] {
            assert!(!is_root_key(folder), "{folder:?} is not a root");
        }
    }

    #[test]
    fn a_folder_is_within_itself_and_its_ancestors_but_not_a_sibling_prefix() {
        assert!(key_is_within("c:/images", "c:/images"));
        assert!(key_is_within("c:/images/set", "c:/images"));
        assert!(!key_is_within("c:/images-old", "c:/images"));
        assert!(!key_is_within("c:/imag", "c:/images"));
    }

    #[test]
    fn a_folder_is_recorded_once_per_kind_whatever_its_spelling() {
        let mut registry = GrantRegistry::default();
        assert!(registry.add_folder("C:/Images", LibraryGrantKind::MonitoredFolder));
        assert!(!registry.add_folder(r"\\?\C:\Images\", LibraryGrantKind::MonitoredFolder));
        assert!(registry.add_folder("C:/Images", LibraryGrantKind::ResourceFolder));

        // Removing one kind keeps the other kind's grant of the same folder.
        assert!(registry.remove_folder(
            &[path_key(Path::new(r"C:\Images\"))],
            LibraryGrantKind::MonitoredFolder
        ));
        assert_eq!(
            folder_paths(&registry, LibraryGrantKind::ResourceFolder),
            vec!["C:/Images"]
        );
        assert!(folder_paths(&registry, LibraryGrantKind::MonitoredFolder).is_empty());
    }

    #[test]
    fn a_granted_folder_covers_its_subfolders_and_nothing_beside_it() {
        // Resolved, as `record_folder` records and the start resolves every folder.
        let root = fs::canonicalize(temp_dir("covers")).unwrap();
        let granted = root.join("granted");
        let inside = granted.join("inside");
        let beside = root.join("granted-beside");
        fs::create_dir_all(&inside).unwrap();
        fs::create_dir_all(&beside).unwrap();
        let mut registry = GrantRegistry::default();
        registry.add_folder(
            &granted.to_string_lossy(),
            LibraryGrantKind::MonitoredFolder,
        );

        assert!(registry.covers(&fs::canonicalize(&granted).unwrap()));
        assert!(registry.covers(&fs::canonicalize(&inside).unwrap()));
        assert!(!registry.covers(&fs::canonicalize(&beside).unwrap()));
        assert!(!registry.covers(&fs::canonicalize(&root).unwrap()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn the_store_round_trips_and_falls_back_to_the_backup() {
        let dir = temp_dir("store");
        let store = GrantStore::new(&dir);
        assert_eq!(store.load(), None);

        let mut registry = GrantRegistry {
            version: REGISTRY_VERSION,
            ..GrantRegistry::default()
        };
        registry.add_folder("D:/Images", LibraryGrantKind::MonitoredFolder);
        assert!(registry.add_files(&["E:/single.png".to_string(), "E:/single.png".to_string()]));
        assert!(!registry.add_files(&["E:/single.png".to_string()]));
        assert_eq!(registry.files, vec!["E:/single.png"]);
        store.save(&registry).unwrap();
        assert_eq!(store.load(), Some(registry.clone()));
        assert!(!dir
            .join(format!("{REGISTRY_FILE_NAME}{TEMP_SUFFIX}"))
            .exists());

        fs::write(dir.join(REGISTRY_FILE_NAME), "{ torn").unwrap();
        assert_eq!(
            store.load(),
            Some(registry.clone()),
            "a torn file falls back"
        );
        fs::remove_file(dir.join(REGISTRY_FILE_NAME)).unwrap();
        assert_eq!(store.load(), Some(registry), "a missing file falls back");

        // An unreadable registry still exists, so it is not seeded over.
        fs::write(
            dir.join(format!("{REGISTRY_FILE_NAME}{BACKUP_SUFFIX}")),
            "{ torn",
        )
        .unwrap();
        assert_eq!(store.load(), None);
        assert!(store.exists());
        let _ = fs::remove_dir_all(dir);
    }

    // #392: only the start seeds a missing registry, and an unreadable one is kept
    // aside and replaced by an empty one, never rebuilt from webview-written data.
    #[test]
    fn only_the_start_seeds_and_an_unreadable_registry_starts_empty() {
        let dir = temp_dir("open");
        let store = GrantStore::new(&dir);
        let seeded = || {
            let mut registry = empty_registry("seed");
            registry.add_folder("D:/Images", LibraryGrantKind::MonitoredFolder);
            registry
        };
        assert!(open_registry(&store, None, "test").is_err());
        assert!(!store.exists(), "a command does not create the registry");
        assert_eq!(
            open_registry(&store, Some(&seeded), "test")
                .unwrap()
                .folder_count(),
            1
        );

        fs::write(dir.join(REGISTRY_FILE_NAME), "{ torn").unwrap();
        fs::write(
            dir.join(format!("{REGISTRY_FILE_NAME}{BACKUP_SUFFIX}")),
            "{ torn",
        )
        .unwrap();
        let registry = open_registry(&store, Some(&seeded), "test").unwrap();
        assert_eq!(registry.folder_count(), 0, "not reseeded");
        assert_eq!(store.load(), Some(registry), "the empty registry is saved");
        let aside = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains(".unreadable-"))
            .count();
        assert_eq!(aside, 2, "both unreadable copies are kept for diagnosis");
        let _ = fs::remove_dir_all(dir);
    }

    // #392: replacing an unreadable registry can fail part-way. Until the empty
    // registry is saved, the unreadable files must stay, so the next start still
    // refuses to seed instead of rebuilding grants from webview-written data.
    #[test]
    fn a_failed_replacement_of_an_unreadable_registry_still_blocks_seeding() {
        let dir = temp_dir("open-fail");
        let store = GrantStore::new(&dir);
        let seeded = || {
            let mut registry = empty_registry("seed");
            registry.add_folder("D:/Images", LibraryGrantKind::MonitoredFolder);
            registry
        };
        fs::write(dir.join(REGISTRY_FILE_NAME), "{ torn").unwrap();
        fs::write(
            dir.join(format!("{REGISTRY_FILE_NAME}{BACKUP_SUFFIX}")),
            "{ torn",
        )
        .unwrap();
        // A folder where the temp file goes makes the save fail.
        let temp = dir.join(format!("{REGISTRY_FILE_NAME}{TEMP_SUFFIX}"));
        fs::create_dir(&temp).unwrap();
        assert!(open_registry(&store, Some(&seeded), "test").is_err());

        fs::remove_dir(&temp).unwrap();
        assert_eq!(
            open_registry(&store, Some(&seeded), "test")
                .unwrap()
                .folder_count(),
            0,
            "the next start does not seed"
        );
        let _ = fs::remove_dir_all(dir);
    }

    // #392: a typed folder is recorded silently only inside a folder the user
    // already granted; anything else outside AppLocalData needs a confirmation.
    #[test]
    fn a_typed_folder_needs_confirmation_unless_a_grant_or_app_data_covers_it() {
        let root = temp_dir("classify");
        let app_local_data = root.join("AppLocalData");
        let granted = root.join("granted");
        let beside = root.join("granted-beside");
        for dir in [
            &app_local_data.join("cache"),
            &granted.join("inside"),
            &beside,
        ] {
            fs::create_dir_all(dir).unwrap();
        }
        let mut registry = GrantRegistry::default();
        registry.add_folder(
            &granted.to_string_lossy(),
            LibraryGrantKind::MonitoredFolder,
        );
        let classify = |path: &Path| {
            classify_folder_request(&registry, &fs::canonicalize(path).unwrap(), &app_local_data)
        };

        assert_eq!(
            classify(&app_local_data.join("cache")),
            FolderRequest::AlwaysReadable
        );
        assert_eq!(classify(&granted.join("inside")), FolderRequest::Covered);
        assert_eq!(classify(&beside), FolderRequest::NeedsConfirmation);
        assert_eq!(classify(&root), FolderRequest::NeedsConfirmation);
        let _ = fs::remove_dir_all(root);
    }

    // #392: the webview can ask `register_library_path` for any folder. Only a
    // folder the user granted, or one inside it, may come back as a grant; any other
    // folder must be refused, however the webview spells it.
    #[test]
    fn register_grants_only_folders_inside_a_recorded_grant() {
        let root = temp_dir("register");
        let app_local_data = root.join("AppLocalData");
        let granted = root.join("granted");
        let beside = root.join("granted-beside");
        for dir in [
            &app_local_data.join("cache"),
            &granted.join("inside"),
            &beside,
        ] {
            fs::create_dir_all(dir).unwrap();
        }
        let mut registry = GrantRegistry::default();
        registry.add_folder(
            &granted.to_string_lossy(),
            LibraryGrantKind::MonitoredFolder,
        );
        let request = |path: &Path| {
            let canonical =
                crate::fs_commands::validate_library_scope_directory(&path.to_string_lossy())?;
            folder_to_grant(&registry, canonical, &app_local_data)
        };
        let canonical = |path: &Path| Some(fs::canonicalize(path).unwrap());

        assert_eq!(request(&granted), Ok(canonical(&granted)));
        assert_eq!(
            request(&granted.join("inside")),
            Ok(canonical(&granted.join("inside")))
        );
        assert_eq!(request(&app_local_data.join("cache")), Ok(None));
        assert!(request(&beside).is_err(), "a sibling folder is refused");
        assert!(request(&root).is_err(), "the parent folder is refused");
        assert!(
            request(
                &granted
                    .join("inside")
                    .join("..")
                    .join("..")
                    .join("granted-beside")
            )
            .is_err(),
            "a `..` escape is refused"
        );

        // A link inside the granted folder that points out of it is judged by
        // where it leads. A junction needs no privilege on Windows.
        let link = granted.join("link-out");
        link_dir(&beside, &link);
        assert!(
            request(&link).is_err(),
            "a link out of the grant is refused"
        );
        let _ = fs::remove_dir(&link);
        let _ = fs::remove_dir_all(root);
    }

    /// Links `link` to the folder `target`: a junction on Windows, as the scanner
    /// tests do, because a symbolic link there needs a privilege.
    fn link_dir(target: &Path, link: &Path) {
        #[cfg(windows)]
        {
            let status = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .stdout(std::process::Stdio::null())
                .status()
                .unwrap();
            assert!(status.success(), "mklink /J failed");
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    // #392: `register_library_path` itself, not only its decision. It waits for the
    // start's restore, and a refused folder must leave both scopes unchanged.
    // #415: a granted folder reaches the asset scope only. In the fs plugin's scope
    // it would be writable and removable by the webview.
    #[test]
    fn register_waits_for_the_restore_and_grants_nothing_it_refuses() {
        use std::time::Duration;
        use tauri_plugin_fs::FsExt;

        // Grants are stored canonical, and the scopes canonicalize only a path that
        // exists, so `readable` below asks about a missing `image.png` as spelled.
        // A temp folder spelled another way (the runner's 8.3 `RUNNER~1`, a
        // junction) would then never match, so spell the root canonically. Real
        // asset requests name files that exist, which the scope does resolve.
        let root = fs::canonicalize(temp_dir("register-command")).unwrap();
        let granted = root.join("granted");
        let beside = root.join("beside");
        fs::create_dir_all(granted.join("inside")).unwrap();
        fs::create_dir_all(&beside).unwrap();
        // The mock's empty identifier would make AppLocalData the whole local
        // profile, which holds the temp folder and so every folder above.
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier = "com.ambit.grant-test".to_string();
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(context)
            .unwrap();
        let handle = app.handle().clone();
        assert!(!granted.starts_with(app_local_data_dir(&handle).unwrap()));
        let mut registry = GrantRegistry::default();
        registry.add_folder(
            &granted.to_string_lossy(),
            LibraryGrantKind::MonitoredFolder,
        );
        let state = LibraryGrantState::default();
        *state.registry.lock().unwrap() = Some(registry);
        handle.manage(state);
        let register = |path: &Path| {
            grant_folder_inside_grants(handle.clone(), path.to_string_lossy().into_owned())
        };
        let readable = |path: &Path| {
            let file = path.join("image.png");
            (
                handle.fs_scope().is_allowed(&file),
                handle.asset_protocol_scope().is_allowed(&file),
            )
        };

        tauri::async_runtime::block_on(async {
            assert!(
                tokio::time::timeout(Duration::from_millis(50), register(&granted))
                    .await
                    .is_err(),
                "waits for the restore"
            );
            handle.state::<LibraryGrantState>().open_gate();

            assert!(register(&beside).await.is_err());
            assert_eq!(
                readable(&beside),
                (false, false),
                "refused: scope unchanged"
            );

            assert_eq!(register(&granted.join("inside")).await, Ok(()));
            assert_eq!(
                readable(&granted.join("inside")),
                (false, true),
                "granted for display, never for the fs plugin"
            );
            assert_eq!(readable(&beside), (false, false));
        });
        let _ = fs::remove_dir_all(root);
    }

    // #415: every backend check of a path the webview names reads the grants
    // through this, now that library folders are not in the fs plugin's scope.
    #[test]
    fn library_access_allows_only_granted_folders_and_files() {
        let root = temp_dir("access");
        let granted = root.join("granted");
        let sibling = root.join("granted-other");
        let loose = root.join("loose");
        let outside = root.join("outside");
        for folder in [&granted.join("sub"), &sibling, &loose, &outside] {
            fs::create_dir_all(folder).unwrap();
        }
        let picked = loose.join("picked.png");
        fs::write(&picked, b"png").unwrap();
        fs::write(loose.join("beside.png"), b"png").unwrap();
        let escape = granted.join("escape");
        link_dir(&outside, &escape);
        // Recorded resolved, as every picked folder is, so its key still matches
        // once its drive is back.
        let unplugged = fs::canonicalize(&root).unwrap().join("unplugged");
        let access = LibraryAccess::new(
            &[&granted, &unplugged],
            &[picked.to_string_lossy().into_owned()],
        );

        assert!(access.allows(&granted));
        assert!(access.allows(&granted.join("sub")));
        assert!(
            access.allows(&granted.join("sub").join("missing.png")),
            "a missing file in a granted folder is reported missing, not refused"
        );
        assert!(access.allows(&picked), "a file picked on its own");

        assert!(
            !access.allows(&loose.join("beside.png")),
            "beside a picked file"
        );
        assert!(!access.allows(&loose));
        assert!(
            !access.allows(&sibling.join("a.png")),
            "same prefix, other folder"
        );
        assert!(!access.allows(&root));
        assert!(
            !access.allows(&escape.join("a.png")),
            "a junction out of the grant"
        );
        assert!(!access.allows(&granted.join("..").join("outside").join("a.png")));
        assert!(
            access.allows(&unplugged.join("a.png")),
            "a folder offline at the start keeps its recorded key"
        );
        assert!(!LibraryAccess::default().allows(&granted));

        let _ = fs::remove_dir(&escape);
        let _ = fs::remove_dir_all(root);
    }

    // #415: a file picked on its own reaches the asset scope only, like a folder.
    #[test]
    fn a_granted_file_reaches_only_the_asset_scope() {
        use tauri_plugin_fs::FsExt;

        let root = temp_dir("file-scope");
        let file = root.join("picked.png");
        fs::write(&file, b"png").unwrap();
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle().clone();

        grant_library_file(&handle, &file.to_string_lossy()).unwrap();
        assert!(handle.asset_protocol_scope().is_allowed(&file));
        assert!(!handle.fs_scope().is_allowed(&file));

        let _ = fs::remove_dir_all(root);
    }

    // #427 review: a snapshot is taken on every command call, some on the main
    // thread, so it must not resolve the recorded folders on disk: a folder on an
    // offline network drive would stall each call. It uses where the start
    // resolved them, and a folder that did not resolve keeps its recorded key.
    #[test]
    fn a_snapshot_uses_the_folders_the_start_resolved_without_the_disk() {
        let root = fs::canonicalize(temp_dir("snapshot-keys")).unwrap();
        let first = root.join("first");
        let second = root.join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        let alias = root.join("alias");
        link_dir(&first, &alias);
        let offline = root.join("offline");
        let mut registry = GrantRegistry::default();
        for folder in [&alias, &offline] {
            registry.add_folder(&folder.to_string_lossy(), LibraryGrantKind::MonitoredFolder);
        }
        // What the start's restore notes for the folder it could resolve.
        registry.remember_resolved(&alias.to_string_lossy(), &fs::canonicalize(&alias).unwrap());
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier = "com.ambit.grant-test".to_string();
        let app = tauri::test::mock_builder().build(context).unwrap();
        let state = LibraryGrantState::default();
        *state.registry.lock().unwrap() = Some(registry);
        app.handle().manage(state);

        // Point the alias elsewhere after the start. A snapshot that resolved it
        // again would follow it to `second`.
        fs::remove_dir(&alias)
            .or_else(|_| fs::remove_file(&alias))
            .unwrap();
        link_dir(&second, &alias);

        let access = LibraryAccess::snapshot(app.handle());
        assert!(access.allows(&first.join("a.png")));
        assert!(!access.allows(&second.join("a.png")));
        assert!(
            access.allows(&offline.join("a.png")),
            "kept by its recorded key, so allowed again when the drive is back"
        );

        let _ = fs::remove_dir(&alias).or_else(|_| fs::remove_file(&alias));
        let _ = fs::remove_dir_all(root);
    }

    // #415: video import and playback check a picked file by its canonical path.
    // A file picked through a junction, a mapped drive or an 8.3 name must still
    // match its record, so the record is the resolved file.
    #[test]
    fn a_file_picked_through_another_spelling_is_recorded_as_resolved() {
        let root = temp_dir("picked-spelling");
        let real = root.join("real");
        fs::create_dir_all(&real).unwrap();
        let file = real.join("clip.mp4");
        fs::write(&file, b"video").unwrap();
        fs::write(real.join("other.mp4"), b"video").unwrap();
        let alias = root.join("alias");
        link_dir(&real, &alias);
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();

        let recorded = grant_picked_files(
            app.handle(),
            &[
                alias.join("clip.mp4").to_string_lossy().into_owned(),
                root.join("missing.mp4").to_string_lossy().into_owned(),
            ],
        );
        assert_eq!(recorded.len(), 1, "a file it cannot grant is not recorded");
        let access = LibraryAccess::new(&[] as &[&Path], &recorded);
        assert!(access.allows(&fs::canonicalize(&file).unwrap()));
        assert!(access.allows(&alias.join("clip.mp4")));
        assert!(!access.allows(&real.join("other.mp4")));

        let _ = fs::remove_dir(&alias);
        let _ = fs::remove_dir_all(root);
    }

    // #415: the hole itself. tauri-plugin-fs admits a webview call when either its
    // runtime scope or the capability allows the path, and Ambit's capability allows
    // writes and removes in AppLocalData. A library folder in that runtime scope
    // was therefore writable and removable by the webview. Runs the real
    // capabilities, as tauri-build compiled them, against a granted folder.
    #[test]
    fn the_webview_cannot_change_a_granted_library_folder_through_the_fs_plugin() {
        use tauri::ipc::{CallbackFn, InvokeBody};
        use tauri::webview::InvokeRequest;

        let root = temp_dir("webview-fs");
        let library = root.join("library");
        fs::create_dir_all(&library).unwrap();
        let image = library.join("image.png");
        fs::write(&image, b"png").unwrap();

        let mut context = tauri::generate_context!(test = true);
        // Its own AppLocalData, not the real app's.
        context.config_mut().identifier = "com.ambit.webview-fs-test".to_string();
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(context)
            .unwrap();
        let handle = app.handle().clone();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        grant_directory_scope(&handle, &fs::canonicalize(&library).unwrap()).unwrap();

        let url = if cfg!(windows) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };
        let call = |command: &str, path: &Path| {
            tauri::test::get_ipc_response(
                &webview,
                InvokeRequest {
                    cmd: format!("plugin:fs|{command}"),
                    callback: CallbackFn(0),
                    error: CallbackFn(1),
                    url: url.parse().unwrap(),
                    body: InvokeBody::Json(serde_json::json!({ "path": path })),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
        };
        let refused = |result: Result<(), String>| {
            result.is_err_and(|error| error.contains("forbidden path"))
        };

        assert!(refused(call("remove", &image)), "remove a library file");
        assert!(
            refused(call("mkdir", &library.join("made"))),
            "create a folder"
        );
        assert!(refused(call("exists", &image)), "probe a library file");
        assert!(image.exists());
        assert!(!library.join("made").exists());

        // The same calls still pass the scope in AppLocalData, so the refusals come
        // from the scope and not from a capability that allows nothing. The file is
        // missing, so the remove fails on disk and nothing is written.
        let own = app_local_data_dir(&handle)
            .unwrap()
            .join("webview-fs-test-missing.png");
        assert_eq!(call("exists", &own), Ok(()));
        let removed = call("remove", &own);
        assert!(removed.is_err() && !refused(removed), "reaches the disk");

        let _ = fs::remove_dir_all(root);
    }

    // #423 review: applying a new root revokes the previous one. When both name the
    // same folder (a trailing slash, another case, a junction to it), the revoke
    // would remove the grant the pick just recorded, and the root would not be
    // granted again at the next start.
    #[test]
    fn a_revoke_keeps_the_folder_that_replaces_it_however_it_is_spelled() {
        let root = temp_dir("revoke-same");
        let sd = root.join("SD");
        let other = root.join("Other");
        fs::create_dir_all(&sd).unwrap();
        fs::create_dir_all(&other).unwrap();
        let alias = root.join("SD-link");
        link_dir(&sd, &alias);
        let spelled = |path: &Path| path.to_string_lossy().into_owned();
        let sd_path = spelled(&sd);

        let trailing = format!("{sd_path}{}", std::path::MAIN_SEPARATOR);
        assert_eq!(revocation_keys(&trailing, Some(&sd_path)), None);
        assert_eq!(revocation_keys(&spelled(&alias), Some(&sd_path)), None);
        assert_eq!(revocation_keys(&sd_path, Some(&spelled(&alias))), None);
        #[cfg(windows)]
        assert_eq!(
            revocation_keys(&sd_path.to_uppercase(), Some(&sd_path)),
            None
        );

        // Another folder, or no replacement, revokes as before.
        let keys = revocation_keys(&sd_path, Some(&spelled(&other))).unwrap();
        let mut registry = GrantRegistry::default();
        registry.add_folder(
            &display_path(&fs::canonicalize(&sd).unwrap()),
            LibraryGrantKind::A1111Root,
        );
        assert!(registry.remove_folder(&keys, LibraryGrantKind::A1111Root));
        assert!(revocation_keys(&sd_path, None).is_some());

        let _ = fs::remove_dir(&alias);
        let _ = fs::remove_dir_all(root);
    }

    // #392 2b review: Browse or Test connection records a new InvokeAI or A1111 root
    // before the user applies it. If the user never applies it, the configured root
    // must still be granted at the next start; only applying the new root, which
    // revokes the old one, may drop it.
    #[test]
    fn an_unapplied_root_keeps_the_configured_root_and_applying_revokes_the_old() {
        for kind in [LibraryGrantKind::InvokeAiRoot, LibraryGrantKind::A1111Root] {
            let mut registry = GrantRegistry::default();
            assert!(registry.add_folder("D:/Configured", kind));

            // Picked or tested, not applied.
            assert!(registry.add_folder("D:/Picked", kind));
            assert_eq!(
                folder_paths(&registry, kind),
                ["D:/Configured", "D:/Picked"]
            );
            assert!(
                !registry.add_folder("D:/Picked", kind),
                "the same root again changes nothing"
            );

            // Applied: the frontend revokes the configured root.
            assert!(registry.remove_folder(&[path_key(Path::new("D:/Configured"))], kind));
            assert_eq!(folder_paths(&registry, kind), ["D:/Picked"]);
        }
    }

    // #392 2b: the webview no longer registers settings folders, so it must not
    // load the library before the start has granted them again; and a restore that
    // fails or panics must still let it in rather than hang the app.
    #[test]
    fn the_gate_opens_only_after_the_restore_however_it_ends() {
        use std::sync::Arc;
        use std::time::Duration;
        let wait = |state: &Arc<LibraryGrantState>, millis| {
            let state = Arc::clone(state);
            tauri::async_runtime::block_on(async move {
                tokio::time::timeout(Duration::from_millis(millis), state.restored())
                    .await
                    .is_ok()
            })
        };

        let state = Arc::new(LibraryGrantState::default());
        assert!(!wait(&state, 50), "closed before the restore");
        let waiter = {
            let state = Arc::clone(&state);
            tauri::async_runtime::spawn(async move { state.restored().await })
        };
        open_gate_after(&state, || Ok(()));
        tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(5), waiter)
                .await
                .expect("a waiting caller is let in")
                .unwrap();
        });
        assert!(wait(&state, 5_000), "later callers pass at once");

        let failed = Arc::new(LibraryGrantState::default());
        open_gate_after(&failed, || Err("unreadable".to_string()));
        assert!(wait(&failed, 5_000), "a failed restore opens the gate");

        let panicked = Arc::new(LibraryGrantState::default());
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            open_gate_after(&panicked, || panic!("restore panicked"))
        }));
        assert!(result.is_err());
        assert!(wait(&panicked, 5_000), "a panicking restore opens the gate");
    }

    // #392: the registry keeps the folder the user approved, not the spelling the
    // webview sent; a relative spelling would name another folder at a later start.
    #[test]
    fn a_folder_is_recorded_by_its_canonical_path() {
        let resolved = crate::fs_commands::validate_library_scope_directory(".").unwrap();
        let recorded = display_path(&resolved);
        assert!(Path::new(&recorded).is_absolute(), "{recorded} is absolute");
        assert!(
            !recorded.starts_with(r"\\?\"),
            "{recorded} has no verbatim prefix"
        );
        assert_eq!(
            path_key(Path::new(&recorded)),
            path_key(&fs::canonicalize(".").unwrap())
        );
    }

    #[test]
    fn seeding_keeps_settings_folders_and_the_folders_of_single_imports() {
        let root = temp_dir("seed");
        let app_local_data = root.join("AppLocalData");
        let monitored = root.join("Monitored");
        let single = root.join("Downloads");
        let unplugged = root.join("Unplugged").join("Models");
        fs::create_dir_all(app_local_data.join(".thumbnails")).unwrap();
        fs::create_dir_all(monitored.join("sub")).unwrap();
        fs::create_dir_all(&single).unwrap();
        let spelled = |path: &Path| path.to_string_lossy().into_owned();

        let registry = seed_registry(
            PreviousGrants {
                folders: vec![
                    (spelled(&monitored), LibraryGrantKind::MonitoredFolder),
                    ("C:/".to_string(), LibraryGrantKind::ResourceFolder),
                    ("/".to_string(), LibraryGrantKind::ResourceFolder),
                    (spelled(&app_local_data), LibraryGrantKind::ResourceFolder),
                    (spelled(&unplugged), LibraryGrantKind::ResourceFolder),
                ],
                media_paths: vec![
                    spelled(&monitored.join("sub").join("a.png")),
                    spelled(&single.join("one.png")),
                    spelled(&single.join("two.png")),
                    spelled(&app_local_data.join(".thumbnails").join("x.webp")),
                    "C:/root-file.png".to_string(),
                ],
            },
            &app_local_data,
            "0.15.0",
        );

        assert_eq!(registry.seeded_by.as_deref(), Some("0.15.0"));
        assert_eq!(
            folder_paths(&registry, LibraryGrantKind::MonitoredFolder),
            vec![spelled(&monitored)]
        );
        // Roots and AppLocalData are skipped; a missing folder is kept for when
        // its drive returns.
        assert_eq!(
            folder_paths(&registry, LibraryGrantKind::ResourceFolder),
            vec![spelled(&unplugged)]
        );
        // Only the single import outside every settings folder gets a folder grant.
        assert_eq!(
            folder_paths(&registry, LibraryGrantKind::ImportedFolder),
            vec![spelled(&single)]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn invoke_settings_naming_the_database_seed_the_root() {
        assert_eq!(invoke_root("D:/Invoke").as_deref(), Some("D:/Invoke"));
        assert_eq!(invoke_root(r"D:\Invoke\").as_deref(), Some("D:/Invoke"));
        assert_eq!(
            invoke_root("D:/Invoke/databases/invokeai.db").as_deref(),
            Some("D:/Invoke")
        );
        assert_eq!(
            invoke_root("D:/Invoke/databases").as_deref(),
            Some("D:/Invoke")
        );
        assert_eq!(invoke_root("  "), None);
    }

    #[test]
    fn settings_folders_read_the_previous_settings_file_or_its_backup() {
        let dir = temp_dir("settings");
        fs::write(
            dir.join("library.json.bak"),
            r#"{"settings":{"monitoredFolders":[{"id":"1","path":"D:/Images"}],
                "resourceFolders":["E:/Models"],"invokeAiPath":"F:/Invoke/databases/invokeai.db",
                "a1111Path":"G:/SD"}}"#,
        )
        .unwrap();
        fs::write(dir.join("library.json"), "{ torn").unwrap();

        assert_eq!(
            settings_folders(&dir),
            vec![
                ("D:/Images".to_string(), LibraryGrantKind::MonitoredFolder),
                ("E:/Models".to_string(), LibraryGrantKind::ResourceFolder),
                ("F:/Invoke".to_string(), LibraryGrantKind::InvokeAiRoot),
                ("G:/SD".to_string(), LibraryGrantKind::A1111Root),
            ]
        );
        let _ = fs::remove_dir_all(dir);
    }

    /// Checks that `denies`, spelled as in a Tauri config, forbid every registry
    /// file in any letter case while leaving other AppLocalData files allowed.
    fn assert_denies_the_registry(denies: &[String], label: &str) {
        assert!(!denies.is_empty(), "{label} denies the registry");
        let app = tauri::test::mock_app();
        let app_local_data = temp_dir(&format!("deny-{label}"));
        let local = app_local_data.to_string_lossy().replace('\\', "/");
        let scope = tauri::scope::fs::Scope::new(
            &app,
            &tauri::utils::config::FsScope::Scope {
                allow: vec![PathBuf::from(format!("{local}/**"))],
                deny: denies
                    .iter()
                    .map(|deny| PathBuf::from(deny.replace("$APPLOCALDATA", &local)))
                    .collect(),
                require_literal_leading_dot: None,
            },
        )
        .unwrap();

        // Windows names are case-insensitive, so a spelling in another case must be
        // denied before the file exists too, or the webview could create it first.
        for name in [
            "LIBRARY-GRANTS.JSON.TMP",
            "Library-Grants.Json",
            "library-GRANTS.json.bak",
        ] {
            let file = app_local_data.join(name);
            assert!(
                scope.is_forbidden(&file),
                "{label}: {} is denied",
                file.display()
            );
        }
        for suffix in ["", BACKUP_SUFFIX, TEMP_SUFFIX, ".unreadable-1"] {
            let file = app_local_data.join(format!("{REGISTRY_FILE_NAME}{suffix}"));
            fs::write(&file, "{}").unwrap();
            assert!(
                scope.is_forbidden(&file),
                "{label}: {} is denied",
                file.display()
            );
            assert!(
                !scope.is_allowed(&file),
                "{label}: {} is not allowed",
                file.display()
            );
        }
        let settings = app_local_data.join("library.json");
        fs::write(&settings, "{}").unwrap();
        assert!(
            scope.is_allowed(&settings),
            "{label}: other AppLocalData files stay allowed"
        );
        let _ = fs::remove_dir_all(app_local_data);
    }

    /// The webview must not be able to write, replace or remove the registry. A
    /// deny in the global `fs:scope` applies to every fs-plugin command (write,
    /// remove, rename, copy, truncate), and tauri-plugin-fs checks denies before
    /// allows, including allows added at runtime.
    #[test]
    fn the_fs_capability_denies_the_registry_files_to_the_webview() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let denies: Vec<String> = capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|permission| permission["identifier"] == "fs:scope")
            .flat_map(|permission| permission["deny"].as_array().cloned().unwrap_or_default())
            .filter_map(|entry| entry["path"].as_str().map(str::to_string))
            .collect();
        assert_denies_the_registry(&denies, "fs-capability");
    }

    /// The asset protocol must not serve the registry either. Its scope also
    /// checks denies first, including against folders granted at runtime.
    #[test]
    fn every_asset_protocol_scope_denies_the_registry_files() {
        for (label, config) in [
            ("release", include_str!("../tauri.conf.json")),
            ("dev", include_str!("../tauri.dev.json")),
            ("qa", include_str!("../tauri.qa.json")),
        ] {
            let config: serde_json::Value = serde_json::from_str(config).unwrap();
            let denies: Vec<String> = config["app"]["security"]["assetProtocol"]["scope"]["deny"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|deny| deny.as_str().map(str::to_string))
                .collect();
            assert_denies_the_registry(&denies, label);
        }
    }
}
