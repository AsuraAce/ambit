const PRODUCTION_IDENTIFIER: &str = "io.github.asuraace.ambit";
const LEGACY_PRODUCTION_IDENTIFIER: &str = "com.ambit.app";
const MAIN_DATABASE_FILES: [&str; 3] = ["images.db", "images.db-wal", "images.db-shm"];
const PURGE_DATABASE_FILES: [&str; 3] = ["images.db-wal", "images.db-shm", "images.db"];
const PURGE_MARKER_FILE: &str = ".purge_on_restart";
pub(crate) const PURGE_JOURNAL_FILE: &str = "library.purge.json";
pub(crate) const PURGE_COMPLETION_FILE: &str = "library.purge.completed";
const DEVELOPMENT_IDENTIFIER: &str = "com.ambit.dev";
const PRODUCTION_IDENTIFIER_PATHS: [&str; 2] =
    [PRODUCTION_IDENTIFIER, LEGACY_PRODUCTION_IDENTIFIER];
const APP_IDENTIFIER_PATHS: [&str; 5] = [
    PRODUCTION_IDENTIFIER,
    LEGACY_PRODUCTION_IDENTIFIER,
    "com.ambit.dev",
    "com.ambit.alpha",
    "com.tauri.dev",
];
#[cfg(not(test))]
const THUMBNAIL_PATH_REPAIR_MARKER: &str = ".thumbnail-path-repair-v1";

#[derive(Debug, PartialEq, Eq)]
enum IdentifierMigrationOutcome {
    LegacyMissing,
    MovedLegacyDirectory,
    MergedLegacyEntries,
    SkippedExistingProfile,
    Failed,
}

#[derive(Debug, PartialEq, Eq)]
enum DatabaseLocalMigrationOutcome {
    SourceMissing,
    Moved,
    Copied,
    SkippedExistingLocal,
    Failed,
}

#[derive(Debug, Clone)]
struct DatabaseFileMove {
    name: &'static str,
    source: std::path::PathBuf,
    destination: std::path::PathBuf,
}

#[derive(Debug, Clone)]
struct AppProfileDir {
    identifier: &'static str,
    path: std::path::PathBuf,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PurgeTransactionArtifact {
    version: u8,
    transaction_id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PurgeJournalArtifact {
    version: u8,
    transaction_id: String,
    before: serde_json::Value,
    after: serde_json::Value,
}

#[cfg(not(test))]
pub(crate) fn migrate_legacy_identifier_data() {
    let config_dir = dirs::config_dir();
    let data_local_dir = dirs::data_local_dir();

    if let Some(config_dir) = &config_dir {
        let legacy_dir = config_dir.join(LEGACY_PRODUCTION_IDENTIFIER);
        let current_dir = config_dir.join(PRODUCTION_IDENTIFIER);
        let _ =
            migrate_identifier_dir(&legacy_dir, &current_dir, &["images.db"], "Roaming AppData");
    } else {
        eprintln!("[IdentifierMigration] Failed to resolve Roaming AppData config directory");
    }

    if let Some(data_local_dir) = &data_local_dir {
        let legacy_dir = data_local_dir.join(LEGACY_PRODUCTION_IDENTIFIER);
        let current_dir = data_local_dir.join(PRODUCTION_IDENTIFIER);
        let _ = migrate_identifier_dir(
            &legacy_dir,
            &current_dir,
            &["library.json", ".thumbnails"],
            "Local AppData",
        );
    } else {
        eprintln!("[IdentifierMigration] Failed to resolve Local AppData directory");
    }

    if let (Some(config_dir), Some(data_local_dir)) = (&config_dir, &data_local_dir) {
        repair_legacy_production_thumbnail_paths(config_dir, data_local_dir);
    }
}

#[cfg(not(test))]
pub(crate) fn migrate_current_database_to_local_app_data() {
    let Some(config_dir) = dirs::config_dir() else {
        eprintln!("[DatabaseLocalMigration] Failed to resolve Roaming AppData config directory");
        return;
    };
    let Some(data_local_dir) = dirs::data_local_dir() else {
        eprintln!("[DatabaseLocalMigration] Failed to resolve Local AppData directory");
        return;
    };

    let roaming_dir = config_dir.join(PRODUCTION_IDENTIFIER);
    let local_dir = data_local_dir.join(PRODUCTION_IDENTIFIER);
    let _ = migrate_database_files_to_local(&roaming_dir, &local_dir);
}

fn migrate_database_files_to_local(
    roaming_dir: &std::path::Path,
    local_dir: &std::path::Path,
) -> DatabaseLocalMigrationOutcome {
    let roaming_db = roaming_dir.join("images.db");
    let local_db = local_dir.join("images.db");

    if local_db.exists() {
        if roaming_db.exists() {
            println!(
                "[DatabaseLocalMigration] Local database already exists at {}; leaving legacy Roaming database at {} for manual recovery",
                local_db.display(),
                roaming_db.display()
            );
        }
        return DatabaseLocalMigrationOutcome::SkippedExistingLocal;
    }

    if !roaming_db.exists() {
        if let Err(error) = std::fs::create_dir_all(local_dir) {
            eprintln!(
                "[DatabaseLocalMigration] Failed to prepare Local AppData directory {}: {error}",
                local_dir.display()
            );
            return DatabaseLocalMigrationOutcome::Failed;
        }
        println!(
            "[DatabaseLocalMigration] No legacy Roaming database found at {}; fresh databases will use {}",
            roaming_db.display(),
            local_dir.display()
        );
        return DatabaseLocalMigrationOutcome::SourceMissing;
    }

    if let Err(error) = std::fs::create_dir_all(local_dir) {
        eprintln!(
            "[DatabaseLocalMigration] Failed to create Local AppData directory {}: {error}",
            local_dir.display()
        );
        return DatabaseLocalMigrationOutcome::Failed;
    }

    let files = existing_database_file_moves(roaming_dir, local_dir);
    if let Some(existing_target) = files
        .iter()
        .find(|file| file.destination.exists())
        .map(|file| file.destination.clone())
    {
        eprintln!(
            "[DatabaseLocalMigration] Skipped moving database because Local AppData already contains {}; Roaming database remains active",
            existing_target.display()
        );
        return DatabaseLocalMigrationOutcome::SkippedExistingLocal;
    }

    match rename_database_files(&files) {
        Ok(()) => {
            println!(
                "[DatabaseLocalMigration] Moved database from {} to {}",
                roaming_dir.display(),
                local_dir.display()
            );
            DatabaseLocalMigrationOutcome::Moved
        }
        Err(error) => {
            eprintln!(
                "[DatabaseLocalMigration] Rename failed; trying copy fallback from {} to {}: {error}",
                roaming_dir.display(),
                local_dir.display()
            );
            match copy_database_files_to_local(&files) {
                Ok(()) => {
                    println!(
                        "[DatabaseLocalMigration] Copied database from {} to {} after rename fallback",
                        roaming_dir.display(),
                        local_dir.display()
                    );
                    DatabaseLocalMigrationOutcome::Copied
                }
                Err(copy_error) => {
                    eprintln!(
                        "[DatabaseLocalMigration] Failed to move database to Local AppData; Ambit will keep using Roaming database at {}: {copy_error}",
                        roaming_db.display()
                    );
                    DatabaseLocalMigrationOutcome::Failed
                }
            }
        }
    }
}

fn existing_database_file_moves(
    roaming_dir: &std::path::Path,
    local_dir: &std::path::Path,
) -> Vec<DatabaseFileMove> {
    MAIN_DATABASE_FILES
        .iter()
        .filter_map(|name| {
            let source = roaming_dir.join(name);
            if !source.exists() {
                return None;
            }

            Some(DatabaseFileMove {
                name: *name,
                source,
                destination: local_dir.join(name),
            })
        })
        .collect()
}

fn rename_database_files(files: &[DatabaseFileMove]) -> Result<(), String> {
    let mut renamed: Vec<DatabaseFileMove> = Vec::new();

    for file in files {
        if let Err(error) = std::fs::rename(&file.source, &file.destination) {
            for previous in renamed.iter().rev() {
                let _ = std::fs::rename(&previous.destination, &previous.source);
            }
            return Err(format!(
                "could not rename {} to {}: {error}",
                file.source.display(),
                file.destination.display()
            ));
        }
        renamed.push(file.clone());
    }

    Ok(())
}

fn copy_database_files_to_local(files: &[DatabaseFileMove]) -> Result<(), String> {
    let temp_suffix = format!(
        "ambit-db-local-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    );
    let mut temp_files: Vec<(std::path::PathBuf, std::path::PathBuf)> = Vec::new();
    let mut committed: Vec<std::path::PathBuf> = Vec::new();

    for file in files {
        if file.destination.exists() {
            cleanup_paths(temp_files.iter().map(|(temp, _)| temp));
            return Err(format!(
                "destination already exists: {}",
                file.destination.display()
            ));
        }

        let temp_destination = file
            .destination
            .with_file_name(format!("{}.{}", file.name, temp_suffix));
        std::fs::copy(&file.source, &temp_destination).map_err(|error| {
            cleanup_paths(temp_files.iter().map(|(temp, _)| temp));
            format!(
                "could not copy {} to {}: {error}",
                file.source.display(),
                temp_destination.display()
            )
        })?;

        let source_len = std::fs::metadata(&file.source)
            .map_err(|error| format!("could not read {}: {error}", file.source.display()))?
            .len();
        let copied_len = std::fs::metadata(&temp_destination)
            .map_err(|error| format!("could not read {}: {error}", temp_destination.display()))?
            .len();
        if source_len != copied_len {
            cleanup_paths(temp_files.iter().map(|(temp, _)| temp));
            let _ = std::fs::remove_file(&temp_destination);
            return Err(format!(
                "copy verification failed for {}: source {} bytes, copy {} bytes",
                file.name, source_len, copied_len
            ));
        }

        temp_files.push((temp_destination, file.destination.clone()));
    }

    for (temp, destination) in &temp_files {
        if let Err(error) = std::fs::rename(temp, destination) {
            cleanup_paths(temp_files.iter().map(|(temp, _)| temp));
            cleanup_paths(committed.iter());
            return Err(format!(
                "could not promote {} to {}: {error}",
                temp.display(),
                destination.display()
            ));
        }
        committed.push(destination.clone());
    }

    for file in files {
        if let Err(error) = std::fs::remove_file(&file.source) {
            eprintln!(
                "[DatabaseLocalMigration] Copied {}, but could not remove legacy source {}: {error}",
                file.name,
                file.source.display()
            );
        }
    }

    Ok(())
}

fn cleanup_paths<'a>(paths: impl Iterator<Item = &'a std::path::PathBuf>) {
    for path in paths {
        let _ = std::fs::remove_file(path);
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
struct DeferredPurgeOutcome {
    profiles_purged: usize,
    database_files_deleted: usize,
    markers_deleted: usize,
    failures: usize,
}

#[cfg(not(test))]
pub(crate) fn check_and_execute_deferred_purge() -> Result<(), String> {
    let roots = app_data_roots_to_check();
    let active_identifier = if cfg!(debug_assertions) {
        DEVELOPMENT_IDENTIFIER
    } else {
        PRODUCTION_IDENTIFIER
    };
    let outcome = execute_deferred_purge_for_roots(&roots, active_identifier);
    if outcome.profiles_purged > 0 {
        println!(
            "[Purge] Completed deferred purge: {} profiles, {} database files, {} markers, {} failures",
            outcome.profiles_purged,
            outcome.database_files_deleted,
            outcome.markers_deleted,
            outcome.failures
        );
    }
    if outcome.failures > 0 {
        return Err(format!(
            "Factory reset recovery is incomplete ({} failure(s)); startup was stopped and recovery evidence was preserved",
            outcome.failures
        ));
    }
    Ok(())
}

fn execute_deferred_purge_for_roots(
    roots: &[std::path::PathBuf],
    active_identifier: &'static str,
) -> DeferredPurgeOutcome {
    let purge_targets: Vec<AppProfileDir> = profile_dirs_for_roots(roots)
        .into_iter()
        .filter(|profile| {
            if is_production_identifier(active_identifier) {
                is_production_identifier(profile.identifier)
            } else {
                profile.identifier == active_identifier
            }
        })
        .collect();
    let marked_profiles: Vec<&AppProfileDir> = purge_targets
        .iter()
        .filter(|profile| profile.path.join(PURGE_MARKER_FILE).exists())
        .collect();
    let journal_profiles: Vec<&AppProfileDir> = purge_targets
        .iter()
        .filter(|profile| profile.path.join(PURGE_JOURNAL_FILE).exists())
        .collect();
    let has_completion_receipt = purge_targets
        .iter()
        .any(|profile| profile.path.join(PURGE_COMPLETION_FILE).exists());

    if marked_profiles.is_empty() {
        if !has_completion_receipt {
            for profile in journal_profiles {
                let _ = remove_existing_file_with_retry(&profile.path.join(PURGE_JOURNAL_FILE));
            }
        }
        return DeferredPurgeOutcome::default();
    }

    let marker_contents: Result<Vec<String>, String> = marked_profiles
        .iter()
        .map(|profile| {
            std::fs::read_to_string(profile.path.join(PURGE_MARKER_FILE))
                .map_err(|error| format!("Failed to read purge marker: {error}"))
        })
        .collect();
    let marker_contents = match marker_contents {
        Ok(contents) => contents,
        Err(error) => {
            eprintln!("[Purge] {error}; recovery evidence was preserved");
            return DeferredPurgeOutcome {
                failures: 1,
                ..Default::default()
            };
        }
    };

    let legacy_marker = marker_contents
        .iter()
        .all(|content| content == "purge requested");
    let transaction = if legacy_marker {
        None
    } else {
        let parsed: Result<Vec<PurgeTransactionArtifact>, _> = marker_contents
            .iter()
            .map(|content| serde_json::from_str(content))
            .collect();
        match parsed {
            Ok(markers)
                if !markers.is_empty()
                    && markers.iter().all(|marker| {
                        marker.version == 1 && marker.transaction_id == markers[0].transaction_id
                    }) =>
            {
                Some(markers[0].transaction_id.clone())
            }
            _ => {
                eprintln!(
                    "[Purge] Invalid or mismatched purge markers; recovery evidence was preserved"
                );
                return DeferredPurgeOutcome {
                    failures: 1,
                    ..Default::default()
                };
            }
        }
    };

    let completion_path = if let Some(transaction_id) = transaction.as_deref() {
        if journal_profiles.len() != 1 {
            eprintln!(
                "[Purge] Expected exactly one purge journal; recovery evidence was preserved"
            );
            return DeferredPurgeOutcome {
                failures: 1,
                ..Default::default()
            };
        }
        let journal_path = journal_profiles[0].path.join(PURGE_JOURNAL_FILE);
        let journal = match read_purge_journal(&journal_path) {
            Ok(journal) if journal.transaction_id == transaction_id => journal,
            Ok(_) | Err(_) => {
                eprintln!("[Purge] Purge journal does not match the committed marker; recovery evidence was preserved");
                return DeferredPurgeOutcome {
                    failures: 1,
                    ..Default::default()
                };
            }
        };
        if journal.version != 1 || !journal.before.is_object() || !journal.after.is_object() {
            eprintln!("[Purge] Purge journal has an invalid state payload; recovery evidence was preserved");
            return DeferredPurgeOutcome {
                failures: 1,
                ..Default::default()
            };
        }
        Some(journal_profiles[0].path.join(PURGE_COMPLETION_FILE))
    } else {
        None
    };

    let mut outcome = DeferredPurgeOutcome::default();
    let mut touched_profiles: Vec<std::path::PathBuf> = Vec::new();

    let completion_exists = match completion_path.as_ref() {
        Some(path) if path.exists() => match read_purge_transaction(path) {
            Ok(receipt)
                if receipt.version == 1
                    && Some(receipt.transaction_id.as_str()) == transaction.as_deref() =>
            {
                true
            }
            _ => {
                eprintln!(
                    "[Purge] Invalid purge completion receipt; recovery evidence was preserved"
                );
                return DeferredPurgeOutcome {
                    failures: 1,
                    ..Default::default()
                };
            }
        },
        _ => false,
    };

    if !completion_exists {
        for target in &purge_targets {
            println!(
                "[Purge] Processing deferred purge for {} at {}",
                target.identifier,
                target.path.display()
            );
            let target_outcome = purge_database_files(&target.path);
            if target_outcome.database_files_deleted > 0 {
                push_unique_path(&mut touched_profiles, target.path.clone());
            }
            outcome.database_files_deleted += target_outcome.database_files_deleted;
            outcome.failures += target_outcome.failures;
        }

        if outcome.failures == 0 {
            if let (Some(path), Some(transaction_id)) =
                (completion_path.as_ref(), transaction.as_ref())
            {
                let receipt = serde_json::to_string_pretty(&PurgeTransactionArtifact {
                    version: 1,
                    transaction_id: transaction_id.clone(),
                })
                .expect("purge receipt serialization should not fail");
                if let Err(error) = atomic_write_new(path, &receipt, transaction_id) {
                    eprintln!("[Purge] Failed to write completion receipt: {error}");
                    outcome.failures += 1;
                }
            }
        }
    }

    if outcome.failures == 0 {
        for target in marked_profiles {
            let target_outcome = purge_purge_marker(&target.path);
            if target_outcome.markers_deleted > 0 {
                push_unique_path(&mut touched_profiles, target.path.clone());
            }
            outcome.markers_deleted += target_outcome.markers_deleted;
            outcome.failures += target_outcome.failures;
        }
    } else {
        eprintln!(
            "[Purge] Deferred purge did not fully clear database files; leaving purge markers for retry on next startup"
        );
    }

    outcome.profiles_purged = touched_profiles.len();
    outcome
}

pub(crate) fn schedule_purge_artifacts(
    journal_dir: &std::path::Path,
    marker_dir: &std::path::Path,
    transaction_id: &str,
    journal_json: &str,
) -> Result<(), String> {
    validate_transaction_id(transaction_id)?;
    let journal: PurgeJournalArtifact = serde_json::from_str(journal_json)
        .map_err(|error| format!("Invalid purge journal: {error}"))?;
    if journal.version != 1
        || journal.transaction_id != transaction_id
        || !journal.before.is_object()
        || !journal.after.is_object()
    {
        return Err("Invalid purge journal payload".to_string());
    }

    std::fs::create_dir_all(journal_dir)
        .map_err(|error| format!("Failed to prepare purge journal directory: {error}"))?;
    std::fs::create_dir_all(marker_dir)
        .map_err(|error| format!("Failed to prepare purge marker directory: {error}"))?;
    let journal_path = journal_dir.join(PURGE_JOURNAL_FILE);
    let marker_path = marker_dir.join(PURGE_MARKER_FILE);
    if journal_path.exists()
        || marker_path.exists()
        || journal_dir.join(PURGE_COMPLETION_FILE).exists()
    {
        return Err("A purge transaction is already pending recovery".to_string());
    }

    atomic_write_new(&journal_path, journal_json, transaction_id)?;
    let marker_json = serde_json::to_string_pretty(&PurgeTransactionArtifact {
        version: 1,
        transaction_id: transaction_id.to_string(),
    })
    .map_err(|error| format!("Failed to serialize purge marker: {error}"))?;
    if let Err(error) = atomic_write_new(&marker_path, &marker_json, transaction_id) {
        let _ = remove_existing_file_with_retry(&journal_path);
        return Err(error);
    }
    Ok(())
}

fn validate_transaction_id(transaction_id: &str) -> Result<(), String> {
    if transaction_id.is_empty()
        || transaction_id.len() > 128
        || !transaction_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Invalid purge transaction id".to_string());
    }
    Ok(())
}

fn atomic_write_new(
    path: &std::path::Path,
    contents: &str,
    transaction_id: &str,
) -> Result<(), String> {
    use std::io::Write;

    if path.exists() {
        return Err(format!(
            "Refusing to replace existing recovery artifact {}",
            path.display()
        ));
    }
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid recovery artifact path {}", path.display()))?;
    let temporary_path = path.with_file_name(format!("{file_name}.{transaction_id}.tmp"));
    if temporary_path.exists() {
        remove_existing_file_with_retry(&temporary_path)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
        .map_err(|error| format!("Failed to create {}: {error}", temporary_path.display()))?;
    if let Err(error) = file
        .write_all(contents.as_bytes())
        .and_then(|_| file.sync_all())
    {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(format!(
            "Failed to write {}: {error}",
            temporary_path.display()
        ));
    }
    drop(file);
    std::fs::rename(&temporary_path, path).map_err(|error| {
        let _ = std::fs::remove_file(&temporary_path);
        format!("Failed to commit {}: {error}", path.display())
    })
}

fn read_purge_journal(path: &std::path::Path) -> Result<PurgeJournalArtifact, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

fn read_purge_transaction(path: &std::path::Path) -> Result<PurgeTransactionArtifact, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

fn profile_dirs_for_roots(roots: &[std::path::PathBuf]) -> Vec<AppProfileDir> {
    let mut profiles = Vec::new();
    for root in roots {
        for identifier in APP_IDENTIFIER_PATHS {
            profiles.push(AppProfileDir {
                identifier,
                path: root.join(identifier),
            });
        }
    }
    profiles
}

fn is_production_identifier(identifier: &str) -> bool {
    PRODUCTION_IDENTIFIER_PATHS.contains(&identifier)
}

fn push_unique_path(paths: &mut Vec<std::path::PathBuf>, path: std::path::PathBuf) {
    if paths.iter().any(|existing| existing == &path) {
        return;
    }
    paths.push(path);
}

fn purge_database_files(profile_dir: &std::path::Path) -> DeferredPurgeOutcome {
    let mut outcome = DeferredPurgeOutcome::default();

    for name in PURGE_DATABASE_FILES {
        let path = profile_dir.join(name);
        match remove_existing_file_with_retry(&path) {
            Ok(true) => {
                println!("[Purge] Deleted {}", path.display());
                outcome.database_files_deleted += 1;
            }
            Ok(false) => {}
            Err(error) => {
                eprintln!("[Purge] Failed to delete {}: {error}", path.display());
                outcome.failures += 1;
            }
        }
    }

    outcome
}

fn purge_purge_marker(profile_dir: &std::path::Path) -> DeferredPurgeOutcome {
    let mut outcome = DeferredPurgeOutcome::default();
    let marker_path = profile_dir.join(PURGE_MARKER_FILE);

    match remove_existing_file_with_retry(&marker_path) {
        Ok(true) => outcome.markers_deleted += 1,
        Ok(false) => {}
        Err(error) => {
            eprintln!("[Purge] Failed to delete purge marker: {error}");
            outcome.failures += 1;
        }
    }

    outcome
}

fn remove_existing_file_with_retry(path: &std::path::Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }

    if std::fs::symlink_metadata(path)
        .map_err(|error| format!("could not inspect {}: {error}", path.display()))?
        .is_dir()
    {
        return Err(format!("refusing to delete directory {}", path.display()));
    }

    let max_attempts = 5;
    for attempt in 1..=max_attempts {
        match std::fs::remove_file(path) {
            Ok(()) => return Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) if attempt == max_attempts => {
                return Err(format!(
                    "could not delete {} after {} attempts: {error}",
                    path.display(),
                    max_attempts
                ));
            }
            Err(_) => std::thread::sleep(std::time::Duration::from_millis(500)),
        }
    }

    Ok(false)
}

#[cfg(not(test))]
fn repair_legacy_production_thumbnail_paths(
    config_dir: &std::path::Path,
    data_local_dir: &std::path::Path,
) {
    let db_path = config_dir.join(PRODUCTION_IDENTIFIER).join("images.db");
    let legacy_thumbnail_dir = data_local_dir
        .join(LEGACY_PRODUCTION_IDENTIFIER)
        .join(".thumbnails");
    let current_thumbnail_dir = data_local_dir
        .join(PRODUCTION_IDENTIFIER)
        .join(".thumbnails");
    let repair_marker = data_local_dir
        .join(PRODUCTION_IDENTIFIER)
        .join(THUMBNAIL_PATH_REPAIR_MARKER);

    if !db_path.exists() {
        return;
    }

    if repair_marker.exists() && !legacy_thumbnail_dir.exists() {
        return;
    }

    match repair_legacy_thumbnail_cache_and_paths(
        &db_path,
        &legacy_thumbnail_dir,
        &current_thumbnail_dir,
    ) {
        Ok(None) => {}
        Ok(Some(updated)) => {
            write_thumbnail_path_repair_marker(&repair_marker);
            if updated > 0 {
                println!(
                    "[IdentifierMigration] Repaired {updated} legacy thumbnail path references in {}",
                    db_path.display()
                );
            }
        }
        Err(error) => {
            eprintln!(
                "[IdentifierMigration] Failed to repair legacy thumbnail path references in {}: {error}",
                db_path.display()
            );
        }
    }
}

#[cfg(not(test))]
fn write_thumbnail_path_repair_marker(repair_marker: &std::path::Path) {
    if let Some(parent) = repair_marker.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            eprintln!(
                "[IdentifierMigration] Failed to create thumbnail path repair marker parent {}: {error}",
                parent.display()
            );
            return;
        }
    }

    if let Err(error) = std::fs::write(repair_marker, "1") {
        eprintln!(
            "[IdentifierMigration] Failed to write thumbnail path repair marker {}: {error}",
            repair_marker.display()
        );
    }
}

fn repair_legacy_thumbnail_cache_and_paths(
    db_path: &std::path::Path,
    legacy_thumbnail_dir: &std::path::Path,
    current_thumbnail_dir: &std::path::Path,
) -> rusqlite::Result<Option<usize>> {
    if !prepare_current_thumbnail_cache(legacy_thumbnail_dir, current_thumbnail_dir) {
        return Ok(None);
    }

    repair_legacy_thumbnail_paths_in_database(db_path, legacy_thumbnail_dir, current_thumbnail_dir)
        .map(Some)
}

fn prepare_current_thumbnail_cache(
    legacy_thumbnail_dir: &std::path::Path,
    current_thumbnail_dir: &std::path::Path,
) -> bool {
    if current_thumbnail_dir.exists() {
        if !current_thumbnail_dir.is_dir() {
            eprintln!(
                "[IdentifierMigration] Failed thumbnail cache repair; current thumbnail path is not a directory: {}",
                current_thumbnail_dir.display()
            );
            return false;
        }

        if !legacy_thumbnail_dir.exists() {
            return true;
        }

        if !legacy_thumbnail_dir.is_dir() {
            eprintln!(
                "[IdentifierMigration] Failed thumbnail cache repair; legacy thumbnail path is not a directory: {}",
                legacy_thumbnail_dir.display()
            );
            return true;
        }

        return match move_path_without_overwrite(
            legacy_thumbnail_dir,
            current_thumbnail_dir,
            "Local thumbnail cache",
        ) {
            Ok((moved, skipped)) => {
                println!(
                    "[IdentifierMigration] Merged Local thumbnail cache from {} to {}; moved {moved} entries, skipped {skipped}",
                    legacy_thumbnail_dir.display(),
                    current_thumbnail_dir.display()
                );
                true
            }
            Err(()) => false,
        };
    }

    if !legacy_thumbnail_dir.exists() {
        println!(
            "[IdentifierMigration] Skipped thumbnail path repair; no thumbnail cache at {} or {}",
            legacy_thumbnail_dir.display(),
            current_thumbnail_dir.display()
        );
        return false;
    }

    if !legacy_thumbnail_dir.is_dir() {
        eprintln!(
            "[IdentifierMigration] Failed thumbnail cache repair; legacy thumbnail path is not a directory: {}",
            legacy_thumbnail_dir.display()
        );
        return false;
    }

    if let Some(parent) = current_thumbnail_dir.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            eprintln!(
                "[IdentifierMigration] Failed thumbnail cache repair; could not create parent {}: {error}",
                parent.display()
            );
            return false;
        }
    }

    match std::fs::rename(legacy_thumbnail_dir, current_thumbnail_dir) {
        Ok(()) => {
            println!(
                "[IdentifierMigration] Moved Local thumbnail cache from {} to {}",
                legacy_thumbnail_dir.display(),
                current_thumbnail_dir.display()
            );
            true
        }
        Err(error) => {
            eprintln!(
                "[IdentifierMigration] Failed thumbnail cache repair; could not move {} to {}: {error}",
                legacy_thumbnail_dir.display(),
                current_thumbnail_dir.display()
            );
            false
        }
    }
}

fn migrate_identifier_dir(
    legacy_dir: &std::path::Path,
    current_dir: &std::path::Path,
    current_profile_markers: &[&str],
    label: &str,
) -> IdentifierMigrationOutcome {
    if !legacy_dir.exists() {
        println!(
            "[IdentifierMigration] Skipped {label}; no legacy directory at {}",
            legacy_dir.display()
        );
        return IdentifierMigrationOutcome::LegacyMissing;
    }

    if !legacy_dir.is_dir() {
        eprintln!(
            "[IdentifierMigration] Failed {label}; legacy path is not a directory: {}",
            legacy_dir.display()
        );
        return IdentifierMigrationOutcome::Failed;
    }

    if !current_dir.exists() {
        if let Some(parent) = current_dir.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                eprintln!(
                    "[IdentifierMigration] Failed {label}; could not create parent {}: {error}",
                    parent.display()
                );
                return IdentifierMigrationOutcome::Failed;
            }
        }

        match std::fs::rename(legacy_dir, current_dir) {
            Ok(()) => {
                println!(
                    "[IdentifierMigration] Moved {label} from {} to {}",
                    legacy_dir.display(),
                    current_dir.display()
                );
                return IdentifierMigrationOutcome::MovedLegacyDirectory;
            }
            Err(error) => {
                eprintln!(
                    "[IdentifierMigration] Failed {label}; could not move {} to {}: {error}",
                    legacy_dir.display(),
                    current_dir.display()
                );
                return IdentifierMigrationOutcome::Failed;
            }
        }
    }

    if !current_dir.is_dir() {
        eprintln!(
            "[IdentifierMigration] Failed {label}; current path is not a directory: {}",
            current_dir.display()
        );
        return IdentifierMigrationOutcome::Failed;
    }

    let blockers: Vec<&str> = current_profile_markers
        .iter()
        .copied()
        .filter(|marker| profile_marker_has_data(&current_dir.join(marker)))
        .collect();
    if !blockers.is_empty() {
        println!(
            "[IdentifierMigration] Skipped {label}; current profile at {} already contains {}",
            current_dir.display(),
            blockers.join(", ")
        );
        return IdentifierMigrationOutcome::SkippedExistingProfile;
    }

    if let Err(error) = std::fs::create_dir_all(current_dir) {
        eprintln!(
            "[IdentifierMigration] Failed {label}; could not create current directory {}: {error}",
            current_dir.display()
        );
        return IdentifierMigrationOutcome::Failed;
    }

    let entries = match std::fs::read_dir(legacy_dir) {
        Ok(entries) => entries,
        Err(error) => {
            eprintln!(
                "[IdentifierMigration] Failed {label}; could not read legacy directory {}: {error}",
                legacy_dir.display()
            );
            return IdentifierMigrationOutcome::Failed;
        }
    };

    let mut moved = 0usize;
    let mut skipped = 0usize;

    for entry in entries {
        let Ok(entry) = entry else {
            skipped += 1;
            continue;
        };
        let source = entry.path();
        let destination = current_dir.join(entry.file_name());
        match move_path_without_overwrite(&source, &destination, label) {
            Ok((moved_count, skipped_count)) => {
                moved += moved_count;
                skipped += skipped_count;
            }
            Err(()) => return IdentifierMigrationOutcome::Failed,
        }
    }

    match std::fs::remove_dir(legacy_dir) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            println!(
                "[IdentifierMigration] Skipped removing non-empty legacy {label} directory {}: {error}",
                legacy_dir.display()
            );
        }
    }

    println!(
        "[IdentifierMigration] Merged {label} from {} to {}; moved {moved} entries, skipped {skipped}",
        legacy_dir.display(),
        current_dir.display()
    );
    IdentifierMigrationOutcome::MergedLegacyEntries
}

fn profile_marker_has_data(path: &std::path::Path) -> bool {
    if !path.exists() {
        return false;
    }

    if path.is_dir() {
        return match std::fs::read_dir(path) {
            Ok(mut entries) => entries.next().is_some(),
            Err(_) => true,
        };
    }

    true
}

fn move_path_without_overwrite(
    source: &std::path::Path,
    destination: &std::path::Path,
    label: &str,
) -> Result<(usize, usize), ()> {
    if destination.exists() {
        if source.is_dir() && destination.is_dir() {
            let entries = match std::fs::read_dir(source) {
                Ok(entries) => entries,
                Err(error) => {
                    eprintln!(
                        "[IdentifierMigration] Failed {label}; could not read nested legacy directory {}: {error}",
                        source.display()
                    );
                    return Err(());
                }
            };

            let mut moved = 0usize;
            let mut skipped = 0usize;
            for entry in entries {
                let Ok(entry) = entry else {
                    skipped += 1;
                    continue;
                };
                let child_source = entry.path();
                let child_destination = destination.join(entry.file_name());
                match move_path_without_overwrite(&child_source, &child_destination, label) {
                    Ok((moved_count, skipped_count)) => {
                        moved += moved_count;
                        skipped += skipped_count;
                    }
                    Err(()) => return Err(()),
                }
            }

            match std::fs::remove_dir(source) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    println!(
                        "[IdentifierMigration] Skipped removing non-empty legacy {label} directory {}: {error}",
                        source.display()
                    );
                }
            }
            return Ok((moved, skipped));
        }

        println!(
            "[IdentifierMigration] Skipped {label} entry; destination already exists: {}",
            destination.display()
        );
        return Ok((0, 1));
    }

    match std::fs::rename(source, destination) {
        Ok(()) => Ok((1, 0)),
        Err(error) => {
            eprintln!(
                "[IdentifierMigration] Failed {label}; could not move {} to {}: {error}",
                source.display(),
                destination.display()
            );
            Err(())
        }
    }
}

fn repair_legacy_thumbnail_paths_in_database(
    db_path: &std::path::Path,
    legacy_thumbnail_dir: &std::path::Path,
    current_thumbnail_dir: &std::path::Path,
) -> rusqlite::Result<usize> {
    let conn = rusqlite::Connection::open(db_path)?;
    let replacements = path_replacement_pairs(legacy_thumbnail_dir, current_thumbnail_dir);
    let mut updated = 0usize;

    for (table, column) in [
        ("images", "thumbnail_path"),
        ("removed_images", "thumbnail_path"),
        ("models", "thumbnail_path"),
        ("models", "sidecar_thumbnail_path"),
        ("facet_cache", "thumbnail_path"),
        ("facet_cache", "safe_thumbnail_path"),
        ("collections", "custom_thumbnail"),
    ] {
        if !column_exists(&conn, table, column)? {
            continue;
        }

        for (legacy_prefix, current_prefix) in &replacements {
            updated += update_path_prefix(&conn, table, column, legacy_prefix, current_prefix)?;
        }
    }

    Ok(updated)
}

fn path_replacement_pairs(
    legacy_thumbnail_dir: &std::path::Path,
    current_thumbnail_dir: &std::path::Path,
) -> Vec<(String, String)> {
    let native_legacy = legacy_thumbnail_dir.to_string_lossy().to_string();
    let native_current = current_thumbnail_dir.to_string_lossy().to_string();
    let forward_legacy = native_legacy.replace('\\', "/");
    let forward_current = native_current.replace('\\', "/");

    let mut pairs = vec![(native_legacy, native_current)];
    if pairs[0].0 != forward_legacy {
        pairs.push((forward_legacy, forward_current));
    }
    pairs
}

fn column_exists(conn: &rusqlite::Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info(\"{table}\")"))?;
    let mut rows = stmt.query([])?;

    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }

    Ok(false)
}

fn update_path_prefix(
    conn: &rusqlite::Connection,
    table: &str,
    column: &str,
    legacy_prefix: &str,
    current_prefix: &str,
) -> rusqlite::Result<usize> {
    let pattern = format!("{}%", escape_sql_like(legacy_prefix));
    conn.execute(
        &format!(
            "UPDATE \"{table}\"
             SET \"{column}\" = replace(\"{column}\", ?1, ?2)
             WHERE \"{column}\" LIKE ?3 ESCAPE '\\'"
        ),
        rusqlite::params![legacy_prefix, current_prefix, pattern],
    )
}

fn escape_sql_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[cfg(not(test))]
pub(crate) fn app_identifier_dirs_to_check() -> Vec<std::path::PathBuf> {
    profile_dirs_for_roots(&app_data_roots_to_check())
        .into_iter()
        .map(|profile| profile.path)
        .collect()
}

#[cfg(not(test))]
fn app_data_roots_to_check() -> Vec<std::path::PathBuf> {
    let mut roots = Vec::new();
    if let Some(config_dir) = dirs::config_dir() {
        roots.push(config_dir);
    }
    if let Some(data_local_dir) = dirs::data_local_dir() {
        roots.push(data_local_dir);
    }
    roots
}

#[cfg(test)]
mod identifier_migration_tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_root(test_name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "ambit-identifier-migration-{test_name}-{}-{timestamp}",
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

    fn write_db_triplet(profile_dir: &Path, label: &str) {
        write_file(&profile_dir.join("images.db"), &format!("{label}-db"));
        write_file(&profile_dir.join("images.db-wal"), &format!("{label}-wal"));
        write_file(&profile_dir.join("images.db-shm"), &format!("{label}-shm"));
    }

    fn write_purge_marker(profile_dir: &Path) {
        write_file(&profile_dir.join(PURGE_MARKER_FILE), "purge requested");
    }

    fn purge_journal_json(transaction_id: &str) -> String {
        serde_json::json!({
            "version": 1,
            "transactionId": transaction_id,
            "before": { "settings": { "maskedKeywords": ["custom"] } },
            "after": { "settings": { "maskedKeywords": ["nsfw", "blood", "gore"] } }
        })
        .to_string()
    }

    fn assert_db_triplet_missing(profile_dir: &Path) {
        assert!(!profile_dir.join("images.db").exists());
        assert!(!profile_dir.join("images.db-wal").exists());
        assert!(!profile_dir.join("images.db-shm").exists());
    }

    fn assert_db_triplet_exists(profile_dir: &Path) {
        assert!(profile_dir.join("images.db").exists());
        assert!(profile_dir.join("images.db-wal").exists());
        assert!(profile_dir.join("images.db-shm").exists());
    }

    fn create_test_db(path: &Path) -> rusqlite::Connection {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("test db parent should be created");
        }
        let conn = rusqlite::Connection::open(path).expect("test db should open");
        conn.execute_batch(
            r#"
            CREATE TABLE images (id TEXT PRIMARY KEY, thumbnail_path TEXT);
            CREATE TABLE removed_images (id TEXT PRIMARY KEY, thumbnail_path TEXT);
            CREATE TABLE models (
                hash TEXT PRIMARY KEY,
                thumbnail_path TEXT,
                sidecar_thumbnail_path TEXT
            );
            CREATE TABLE facet_cache (
                facet_type TEXT NOT NULL,
                resource_name TEXT NOT NULL,
                thumbnail_path TEXT,
                safe_thumbnail_path TEXT,
                PRIMARY KEY (facet_type, resource_name)
            );
            CREATE TABLE collections (id TEXT PRIMARY KEY, custom_thumbnail TEXT);
            "#,
        )
        .expect("test schema should be created");
        conn
    }

    fn insert_image_thumbnail(conn: &rusqlite::Connection, id: &str, thumbnail_path: &str) {
        conn.execute(
            "INSERT INTO images (id, thumbnail_path) VALUES (?1, ?2)",
            rusqlite::params![id, thumbnail_path],
        )
        .expect("image thumbnail row should be inserted");
    }

    fn image_thumbnail_path(conn: &rusqlite::Connection, id: &str) -> String {
        conn.query_row(
            "SELECT thumbnail_path FROM images WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .expect("image thumbnail path should be returned")
    }

    #[test]
    fn skips_when_legacy_directory_is_missing() {
        let root = unique_temp_root("missing");
        let legacy = root.join(LEGACY_PRODUCTION_IDENTIFIER);
        let current = root.join(PRODUCTION_IDENTIFIER);

        let outcome = migrate_identifier_dir(&legacy, &current, &["images.db"], "test profile");

        assert_eq!(outcome, IdentifierMigrationOutcome::LegacyMissing);
        assert!(!current.exists());
        cleanup(&root);
    }

    #[test]
    fn moves_legacy_directory_when_current_profile_is_absent() {
        let root = unique_temp_root("move");
        let legacy = root.join(LEGACY_PRODUCTION_IDENTIFIER);
        let current = root.join(PRODUCTION_IDENTIFIER);
        write_file(&legacy.join("images.db"), "legacy-db");

        let outcome = migrate_identifier_dir(&legacy, &current, &["images.db"], "test profile");

        assert_eq!(outcome, IdentifierMigrationOutcome::MovedLegacyDirectory);
        assert!(!legacy.exists());
        assert_eq!(
            fs::read_to_string(current.join("images.db")).expect("migrated db should exist"),
            "legacy-db"
        );
        cleanup(&root);
    }

    #[test]
    fn database_local_migration_moves_db_wal_and_shm_together() {
        let root = unique_temp_root("db-local-move");
        let roaming = root.join("Roaming").join(PRODUCTION_IDENTIFIER);
        let local = root.join("Local").join(PRODUCTION_IDENTIFIER);
        write_file(&roaming.join("images.db"), "db");
        write_file(&roaming.join("images.db-wal"), "wal");
        write_file(&roaming.join("images.db-shm"), "shm");

        let outcome = migrate_database_files_to_local(&roaming, &local);

        assert_eq!(outcome, DatabaseLocalMigrationOutcome::Moved);
        assert!(!roaming.join("images.db").exists());
        assert!(!roaming.join("images.db-wal").exists());
        assert!(!roaming.join("images.db-shm").exists());
        assert_eq!(
            fs::read_to_string(local.join("images.db")).expect("local db should exist"),
            "db"
        );
        assert_eq!(
            fs::read_to_string(local.join("images.db-wal")).expect("local wal should exist"),
            "wal"
        );
        assert_eq!(
            fs::read_to_string(local.join("images.db-shm")).expect("local shm should exist"),
            "shm"
        );
        cleanup(&root);
    }

    #[test]
    fn database_local_migration_does_not_overwrite_existing_local_db() {
        let root = unique_temp_root("db-local-conflict");
        let roaming = root.join("Roaming").join(PRODUCTION_IDENTIFIER);
        let local = root.join("Local").join(PRODUCTION_IDENTIFIER);
        write_file(&roaming.join("images.db"), "roaming-db");
        write_file(&local.join("images.db"), "local-db");

        let outcome = migrate_database_files_to_local(&roaming, &local);

        assert_eq!(outcome, DatabaseLocalMigrationOutcome::SkippedExistingLocal);
        assert_eq!(
            fs::read_to_string(roaming.join("images.db")).expect("roaming db should remain"),
            "roaming-db"
        );
        assert_eq!(
            fs::read_to_string(local.join("images.db")).expect("local db should remain"),
            "local-db"
        );
        cleanup(&root);
    }

    #[test]
    fn database_local_migration_failure_leaves_roaming_db_usable() {
        let root = unique_temp_root("db-local-failure");
        let roaming = root.join("Roaming").join(PRODUCTION_IDENTIFIER);
        let local = root.join("Local").join(PRODUCTION_IDENTIFIER);
        write_file(&roaming.join("images.db"), "roaming-db");
        write_file(&local, "not-a-directory");

        let outcome = migrate_database_files_to_local(&roaming, &local);

        assert_eq!(outcome, DatabaseLocalMigrationOutcome::Failed);
        assert_eq!(
            fs::read_to_string(roaming.join("images.db")).expect("roaming db should remain"),
            "roaming-db"
        );
        cleanup(&root);
    }

    #[test]
    fn database_copy_fallback_copies_and_verifies_existing_files() {
        let root = unique_temp_root("db-copy-fallback");
        let roaming = root.join("Roaming").join(PRODUCTION_IDENTIFIER);
        let local = root.join("Local").join(PRODUCTION_IDENTIFIER);
        write_file(&roaming.join("images.db"), "db");
        write_file(&roaming.join("images.db-wal"), "wal");
        fs::create_dir_all(&local).expect("local test directory should be created");
        let files = existing_database_file_moves(&roaming, &local);

        copy_database_files_to_local(&files).expect("copy fallback should succeed");

        assert_eq!(
            fs::read_to_string(local.join("images.db")).expect("local db should exist"),
            "db"
        );
        assert_eq!(
            fs::read_to_string(local.join("images.db-wal")).expect("local wal should exist"),
            "wal"
        );
        assert!(!roaming.join("images.db").exists());
        assert!(!roaming.join("images.db-wal").exists());
        cleanup(&root);
    }

    #[test]
    fn database_local_migration_prepares_local_dir_for_fresh_profile() {
        let root = unique_temp_root("db-local-fresh");
        let roaming = root.join("Roaming").join(PRODUCTION_IDENTIFIER);
        let local = root.join("Local").join(PRODUCTION_IDENTIFIER);

        let outcome = migrate_database_files_to_local(&roaming, &local);

        assert_eq!(outcome, DatabaseLocalMigrationOutcome::SourceMissing);
        assert!(local.is_dir());
        cleanup(&root);
    }

    #[test]
    fn deferred_production_purge_removes_local_and_roaming_catalogs() {
        let root = unique_temp_root("purge-prod-current");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let local_profile = local_root.join(PRODUCTION_IDENTIFIER);
        let roaming_profile = roaming_root.join(PRODUCTION_IDENTIFIER);
        let dev_profile = local_root.join("com.ambit.dev");
        write_purge_marker(&local_profile);
        write_purge_marker(&roaming_profile);
        write_db_triplet(&local_profile, "local");
        write_db_triplet(&roaming_profile, "roaming");
        write_db_triplet(&dev_profile, "dev");
        write_file(&local_profile.join("library.json"), "{}");

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], PRODUCTION_IDENTIFIER);

        assert_eq!(outcome.database_files_deleted, 6);
        assert_eq!(outcome.markers_deleted, 2);
        assert_db_triplet_missing(&local_profile);
        assert_db_triplet_missing(&roaming_profile);
        assert_db_triplet_exists(&dev_profile);
        assert_eq!(
            fs::read_to_string(local_profile.join("library.json"))
                .expect("library settings should not be purged"),
            "{}"
        );
        assert!(!local_profile.join(PURGE_MARKER_FILE).exists());
        assert!(!roaming_profile.join(PURGE_MARKER_FILE).exists());
        cleanup(&root);
    }

    #[test]
    fn deferred_roaming_fallback_purge_prevents_local_migration_restore() {
        let root = unique_temp_root("purge-roaming-fallback");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let roaming_profile = roaming_root.join(PRODUCTION_IDENTIFIER);
        let local_profile = local_root.join(PRODUCTION_IDENTIFIER);
        write_purge_marker(&roaming_profile);
        write_db_triplet(&roaming_profile, "roaming");

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], PRODUCTION_IDENTIFIER);
        let migration_outcome = migrate_database_files_to_local(&roaming_profile, &local_profile);

        assert_eq!(outcome.database_files_deleted, 3);
        assert_eq!(outcome.markers_deleted, 1);
        assert_eq!(
            migration_outcome,
            DatabaseLocalMigrationOutcome::SourceMissing
        );
        assert_db_triplet_missing(&roaming_profile);
        assert!(!local_profile.join("images.db").exists());
        cleanup(&root);
    }

    #[test]
    fn deferred_production_purge_removes_legacy_catalog_copies() {
        let root = unique_temp_root("purge-prod-legacy");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let current_profile = local_root.join(PRODUCTION_IDENTIFIER);
        let legacy_local_profile = local_root.join(LEGACY_PRODUCTION_IDENTIFIER);
        let legacy_roaming_profile = roaming_root.join(LEGACY_PRODUCTION_IDENTIFIER);
        write_purge_marker(&current_profile);
        write_db_triplet(&legacy_local_profile, "legacy-local");
        write_db_triplet(&legacy_roaming_profile, "legacy-roaming");

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], PRODUCTION_IDENTIFIER);

        assert_eq!(outcome.database_files_deleted, 6);
        assert_db_triplet_missing(&legacy_local_profile);
        assert_db_triplet_missing(&legacy_roaming_profile);
        cleanup(&root);
    }

    #[test]
    fn deferred_non_production_purge_is_limited_to_marked_profile() {
        let root = unique_temp_root("purge-dev-only");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let dev_profile = local_root.join("com.ambit.dev");
        let local_profile = local_root.join(PRODUCTION_IDENTIFIER);
        let roaming_profile = roaming_root.join(PRODUCTION_IDENTIFIER);
        write_purge_marker(&dev_profile);
        write_db_triplet(&dev_profile, "dev");
        write_db_triplet(&local_profile, "local");
        write_db_triplet(&roaming_profile, "roaming");

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], DEVELOPMENT_IDENTIFIER);

        assert_eq!(outcome.database_files_deleted, 3);
        assert_eq!(outcome.markers_deleted, 1);
        assert_db_triplet_missing(&dev_profile);
        assert_db_triplet_exists(&local_profile);
        assert_db_triplet_exists(&roaming_profile);
        cleanup(&root);
    }

    #[test]
    fn deferred_production_purge_keeps_marker_when_database_delete_fails() {
        let root = unique_temp_root("purge-prod-failure-keeps-marker");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let local_profile = local_root.join(PRODUCTION_IDENTIFIER);
        write_purge_marker(&local_profile);
        fs::create_dir_all(local_profile.join("images.db"))
            .expect("directory-shaped db sentinel should be created");
        write_file(&local_profile.join("images.db-wal"), "wal");
        write_file(&local_profile.join("images.db-shm"), "shm");

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], PRODUCTION_IDENTIFIER);

        assert_eq!(outcome.database_files_deleted, 2);
        assert_eq!(outcome.markers_deleted, 0);
        assert_eq!(outcome.failures, 1);
        assert!(local_profile.join(PURGE_MARKER_FILE).exists());
        assert!(local_profile.join("images.db").is_dir());
        assert!(!local_profile.join("images.db-wal").exists());
        assert!(!local_profile.join("images.db-shm").exists());
        cleanup(&root);
    }

    #[test]
    fn deferred_unmarked_roaming_failure_keeps_only_production_marker() {
        let root = unique_temp_root("purge-roaming-failure-keeps-marker");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let local_profile = local_root.join(PRODUCTION_IDENTIFIER);
        let roaming_profile = roaming_root.join(PRODUCTION_IDENTIFIER);
        write_purge_marker(&local_profile);
        fs::create_dir_all(roaming_profile.join("images.db"))
            .expect("directory-shaped roaming db sentinel should be created");

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], PRODUCTION_IDENTIFIER);

        assert_eq!(outcome.database_files_deleted, 0);
        assert_eq!(outcome.markers_deleted, 0);
        assert_eq!(outcome.failures, 1);
        assert!(local_profile.join(PURGE_MARKER_FILE).exists());
        assert!(roaming_profile.join("images.db").is_dir());
        cleanup(&root);
    }

    #[test]
    fn deferred_non_production_failure_keeps_only_its_marker() {
        let root = unique_temp_root("purge-dev-failure-keeps-marker");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let dev_profile = local_root.join("com.ambit.dev");
        let local_profile = local_root.join(PRODUCTION_IDENTIFIER);
        write_purge_marker(&dev_profile);
        fs::create_dir_all(dev_profile.join("images.db"))
            .expect("directory-shaped dev db sentinel should be created");
        write_db_triplet(&local_profile, "local");

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], DEVELOPMENT_IDENTIFIER);

        assert_eq!(outcome.database_files_deleted, 0);
        assert_eq!(outcome.markers_deleted, 0);
        assert_eq!(outcome.failures, 1);
        assert!(dev_profile.join(PURGE_MARKER_FILE).exists());
        assert!(dev_profile.join("images.db").is_dir());
        assert_db_triplet_exists(&local_profile);
        cleanup(&root);
    }

    #[test]
    fn deferred_marker_only_purge_removes_stale_marker() {
        let root = unique_temp_root("purge-marker-only");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let local_profile = local_root.join(PRODUCTION_IDENTIFIER);
        write_purge_marker(&local_profile);

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], PRODUCTION_IDENTIFIER);

        assert_eq!(outcome.database_files_deleted, 0);
        assert_eq!(outcome.markers_deleted, 1);
        assert_eq!(outcome.failures, 0);
        assert!(!local_profile.join(PURGE_MARKER_FILE).exists());
        cleanup(&root);
    }

    #[test]
    fn deferred_purge_without_marker_leaves_database_files() {
        let root = unique_temp_root("purge-no-marker");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let local_profile = local_root.join(PRODUCTION_IDENTIFIER);
        let roaming_profile = roaming_root.join(PRODUCTION_IDENTIFIER);
        write_db_triplet(&local_profile, "local");
        write_db_triplet(&roaming_profile, "roaming");

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], PRODUCTION_IDENTIFIER);

        assert_eq!(outcome, DeferredPurgeOutcome::default());
        assert_db_triplet_exists(&local_profile);
        assert_db_triplet_exists(&roaming_profile);
        cleanup(&root);
    }

    #[test]
    fn purge_schedule_commits_journal_before_matching_marker() {
        let root = unique_temp_root("purge-schedule");
        let journal_dir = root.join("Local").join(PRODUCTION_IDENTIFIER);
        let marker_dir = root.join("Roaming").join(PRODUCTION_IDENTIFIER);
        let transaction_id = "purge-transaction-1";
        let journal_json = purge_journal_json(transaction_id);

        schedule_purge_artifacts(&journal_dir, &marker_dir, transaction_id, &journal_json)
            .expect("purge transaction should be scheduled");

        assert_eq!(
            fs::read_to_string(journal_dir.join(PURGE_JOURNAL_FILE)).unwrap(),
            journal_json
        );
        let marker = read_purge_transaction(&marker_dir.join(PURGE_MARKER_FILE)).unwrap();
        assert_eq!(marker.transaction_id, transaction_id);
        cleanup(&root);
    }

    #[test]
    fn purge_schedule_removes_uncommitted_journal_when_marker_write_fails() {
        let root = unique_temp_root("purge-schedule-marker-failure");
        let journal_dir = root.join("Local").join(PRODUCTION_IDENTIFIER);
        let marker_dir = root.join("Roaming").join(PRODUCTION_IDENTIFIER);
        let transaction_id = "purge-transaction-2";
        fs::create_dir_all(marker_dir.join(format!("{PURGE_MARKER_FILE}.{transaction_id}.tmp")))
            .expect("marker temp conflict should be created");

        let result = schedule_purge_artifacts(
            &journal_dir,
            &marker_dir,
            transaction_id,
            &purge_journal_json(transaction_id),
        );

        assert!(result.is_err());
        assert!(!journal_dir.join(PURGE_JOURNAL_FILE).exists());
        assert!(!marker_dir.join(PURGE_MARKER_FILE).exists());
        cleanup(&root);
    }

    #[test]
    fn committed_purge_deletes_sqlite_then_writes_completion_receipt() {
        let root = unique_temp_root("purge-committed-recovery");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let local_profile = local_root.join(PRODUCTION_IDENTIFIER);
        let roaming_profile = roaming_root.join(PRODUCTION_IDENTIFIER);
        let transaction_id = "purge-transaction-3";
        write_db_triplet(&local_profile, "local");
        write_db_triplet(&roaming_profile, "roaming");
        schedule_purge_artifacts(
            &local_profile,
            &roaming_profile,
            transaction_id,
            &purge_journal_json(transaction_id),
        )
        .unwrap();

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], PRODUCTION_IDENTIFIER);

        assert_eq!(outcome.database_files_deleted, 6);
        assert_eq!(outcome.failures, 0);
        assert_db_triplet_missing(&local_profile);
        assert_db_triplet_missing(&roaming_profile);
        assert!(!roaming_profile.join(PURGE_MARKER_FILE).exists());
        assert!(local_profile.join(PURGE_JOURNAL_FILE).exists());
        let receipt = read_purge_transaction(&local_profile.join(PURGE_COMPLETION_FILE)).unwrap();
        assert_eq!(receipt.transaction_id, transaction_id);
        cleanup(&root);
    }

    #[test]
    fn committed_purge_keeps_marker_and_journal_when_database_delete_fails() {
        let root = unique_temp_root("purge-committed-delete-failure");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let profile = local_root.join(PRODUCTION_IDENTIFIER);
        let transaction_id = "purge-transaction-4";
        fs::create_dir_all(profile.join("images.db"))
            .expect("directory-shaped db sentinel should be created");
        schedule_purge_artifacts(
            &profile,
            &profile,
            transaction_id,
            &purge_journal_json(transaction_id),
        )
        .unwrap();

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], PRODUCTION_IDENTIFIER);

        assert_eq!(outcome.failures, 1);
        assert!(profile.join("images.db").is_dir());
        assert!(profile.join(PURGE_MARKER_FILE).exists());
        assert!(profile.join(PURGE_JOURNAL_FILE).exists());
        assert!(!profile.join(PURGE_COMPLETION_FILE).exists());
        cleanup(&root);
    }

    #[test]
    fn completed_native_purge_recovery_is_idempotent() {
        let root = unique_temp_root("purge-idempotent-recovery");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let profile = local_root.join(PRODUCTION_IDENTIFIER);
        let transaction_id = "purge-transaction-5";
        write_db_triplet(&profile, "production");
        schedule_purge_artifacts(
            &profile,
            &profile,
            transaction_id,
            &purge_journal_json(transaction_id),
        )
        .unwrap();
        let roots = [roaming_root, local_root];

        let first = execute_deferred_purge_for_roots(&roots, PRODUCTION_IDENTIFIER);
        let second = execute_deferred_purge_for_roots(&roots, PRODUCTION_IDENTIFIER);

        assert_eq!(first.failures, 0);
        assert_eq!(second, DeferredPurgeOutcome::default());
        assert_db_triplet_missing(&profile);
        assert!(profile.join(PURGE_JOURNAL_FILE).exists());
        assert!(profile.join(PURGE_COMPLETION_FILE).exists());
        cleanup(&root);
    }

    #[test]
    fn development_recovery_does_not_consume_installed_profile_transaction() {
        let root = unique_temp_root("purge-profile-isolation");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let production_profile = local_root.join(PRODUCTION_IDENTIFIER);
        let development_profile = local_root.join(DEVELOPMENT_IDENTIFIER);
        write_db_triplet(&production_profile, "production");
        write_db_triplet(&development_profile, "development");
        schedule_purge_artifacts(
            &production_profile,
            &production_profile,
            "production-purge",
            &purge_journal_json("production-purge"),
        )
        .unwrap();

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], DEVELOPMENT_IDENTIFIER);

        assert_eq!(outcome, DeferredPurgeOutcome::default());
        assert_db_triplet_exists(&production_profile);
        assert_db_triplet_exists(&development_profile);
        assert!(production_profile.join(PURGE_MARKER_FILE).exists());
        cleanup(&root);
    }

    #[test]
    fn mismatched_transaction_preserves_database_and_recovery_evidence() {
        let root = unique_temp_root("purge-mismatch");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let profile = local_root.join(PRODUCTION_IDENTIFIER);
        write_db_triplet(&profile, "production");
        write_file(
            &profile.join(PURGE_JOURNAL_FILE),
            &purge_journal_json("journal-transaction"),
        );
        write_file(
            &profile.join(PURGE_MARKER_FILE),
            &serde_json::json!({
                "version": 1,
                "transactionId": "marker-transaction"
            })
            .to_string(),
        );

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], PRODUCTION_IDENTIFIER);

        assert_eq!(outcome.failures, 1);
        assert_db_triplet_exists(&profile);
        assert!(profile.join(PURGE_JOURNAL_FILE).exists());
        assert!(profile.join(PURGE_MARKER_FILE).exists());
        assert!(!profile.join(PURGE_COMPLETION_FILE).exists());
        cleanup(&root);
    }

    #[test]
    fn precommit_orphan_journal_is_discarded_without_touching_database() {
        let root = unique_temp_root("purge-orphan-journal");
        let roaming_root = root.join("Roaming");
        let local_root = root.join("Local");
        let profile = local_root.join(PRODUCTION_IDENTIFIER);
        write_db_triplet(&profile, "production");
        write_file(
            &profile.join(PURGE_JOURNAL_FILE),
            &purge_journal_json("orphan-transaction"),
        );

        let outcome =
            execute_deferred_purge_for_roots(&[roaming_root, local_root], PRODUCTION_IDENTIFIER);

        assert_eq!(outcome, DeferredPurgeOutcome::default());
        assert_db_triplet_exists(&profile);
        assert!(!profile.join(PURGE_JOURNAL_FILE).exists());
        cleanup(&root);
    }

    #[test]
    fn does_not_overwrite_existing_database_profile() {
        let root = unique_temp_root("db-conflict");
        let legacy = root.join(LEGACY_PRODUCTION_IDENTIFIER);
        let current = root.join(PRODUCTION_IDENTIFIER);
        write_file(&legacy.join("images.db"), "legacy-db");
        write_file(&current.join("images.db"), "current-db");

        let outcome = migrate_identifier_dir(&legacy, &current, &["images.db"], "test profile");

        assert_eq!(outcome, IdentifierMigrationOutcome::SkippedExistingProfile);
        assert_eq!(
            fs::read_to_string(legacy.join("images.db")).expect("legacy db should remain"),
            "legacy-db"
        );
        assert_eq!(
            fs::read_to_string(current.join("images.db")).expect("current db should remain"),
            "current-db"
        );
        cleanup(&root);
    }

    #[test]
    fn merges_into_existing_empty_current_directory() {
        let root = unique_temp_root("merge");
        let legacy = root.join(LEGACY_PRODUCTION_IDENTIFIER);
        let current = root.join(PRODUCTION_IDENTIFIER);
        write_file(&legacy.join("library.json"), "{}");
        write_file(&legacy.join(".thumbnails").join("sample.webp"), "thumb");
        fs::create_dir_all(current.join(".thumbnails"))
            .expect("empty current thumbnails directory should be created");

        let outcome = migrate_identifier_dir(
            &legacy,
            &current,
            &["library.json", ".thumbnails"],
            "test profile",
        );

        assert_eq!(outcome, IdentifierMigrationOutcome::MergedLegacyEntries);
        assert!(!legacy.exists());
        assert_eq!(
            fs::read_to_string(current.join("library.json")).expect("settings should migrate"),
            "{}"
        );
        assert_eq!(
            fs::read_to_string(current.join(".thumbnails").join("sample.webp"))
                .expect("thumbnail should migrate"),
            "thumb"
        );
        cleanup(&root);
    }

    #[test]
    fn does_not_overwrite_existing_local_profile_assets() {
        let root = unique_temp_root("local-conflict");
        let legacy = root.join(LEGACY_PRODUCTION_IDENTIFIER);
        let current = root.join(PRODUCTION_IDENTIFIER);
        write_file(&legacy.join("library.json"), "{\"legacy\":true}");
        write_file(&current.join(".thumbnails").join("current.webp"), "current");

        let outcome = migrate_identifier_dir(
            &legacy,
            &current,
            &["library.json", ".thumbnails"],
            "test profile",
        );

        assert_eq!(outcome, IdentifierMigrationOutcome::SkippedExistingProfile);
        assert_eq!(
            fs::read_to_string(legacy.join("library.json")).expect("legacy settings should remain"),
            "{\"legacy\":true}"
        );
        assert_eq!(
            fs::read_to_string(current.join(".thumbnails").join("current.webp"))
                .expect("current thumbnail should remain"),
            "current"
        );
        cleanup(&root);
    }

    #[test]
    fn repairs_legacy_thumbnail_paths_in_database() {
        let root = unique_temp_root("repair-db");
        let db_path = root.join("images.db");
        let legacy_thumb = root
            .join("Local")
            .join(LEGACY_PRODUCTION_IDENTIFIER)
            .join(".thumbnails");
        let current_thumb = root
            .join("Local")
            .join(PRODUCTION_IDENTIFIER)
            .join(".thumbnails");
        let legacy_native = legacy_thumb.to_string_lossy().to_string();
        let current_native = current_thumb.to_string_lossy().to_string();
        let legacy_forward = legacy_native.replace('\\', "/");
        let current_forward = current_native.replace('\\', "/");
        let conn = create_test_db(&db_path);

        conn.execute(
            "INSERT INTO images (id, thumbnail_path) VALUES ('img1', ?1)",
            [format!("{legacy_native}\\one.webp")],
        )
        .expect("image row should be inserted");
        conn.execute(
            "INSERT INTO removed_images (id, thumbnail_path) VALUES ('old1', ?1)",
            [format!("{legacy_forward}/two.webp")],
        )
        .expect("removed image row should be inserted");
        conn.execute(
            "INSERT INTO models (hash, thumbnail_path, sidecar_thumbnail_path) VALUES ('m1', ?1, ?2)",
            [
                format!("{legacy_native}\\model.webp"),
                format!("{legacy_forward}/sidecar.webp"),
            ],
        )
        .expect("model row should be inserted");
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, thumbnail_path, safe_thumbnail_path) VALUES ('checkpoints', 'm1', ?1, ?2)",
            [
                format!("{legacy_native}\\facet.webp"),
                format!("{legacy_forward}/safe.webp"),
            ],
        )
        .expect("facet row should be inserted");
        conn.execute(
            "INSERT INTO collections (id, custom_thumbnail) VALUES ('c1', ?1)",
            [format!("{legacy_native}\\collection.webp")],
        )
        .expect("collection row should be inserted");
        drop(conn);

        let updated =
            repair_legacy_thumbnail_paths_in_database(&db_path, &legacy_thumb, &current_thumb)
                .expect("thumbnail path repair should succeed");

        assert_eq!(updated, 7);
        let conn = rusqlite::Connection::open(&db_path).expect("test db should reopen");
        let image_path: String = conn
            .query_row(
                "SELECT thumbnail_path FROM images WHERE id = 'img1'",
                [],
                |row| row.get(0),
            )
            .expect("image path should be returned");
        let removed_path: String = conn
            .query_row(
                "SELECT thumbnail_path FROM removed_images WHERE id = 'old1'",
                [],
                |row| row.get(0),
            )
            .expect("removed image path should be returned");
        let sidecar_path: String = conn
            .query_row(
                "SELECT sidecar_thumbnail_path FROM models WHERE hash = 'm1'",
                [],
                |row| row.get(0),
            )
            .expect("model sidecar path should be returned");

        assert_eq!(image_path, format!("{current_native}\\one.webp"));
        assert_eq!(removed_path, format!("{current_forward}/two.webp"));
        assert_eq!(sidecar_path, format!("{current_forward}/sidecar.webp"));
        cleanup(&root);
    }

    #[test]
    fn moves_legacy_thumbnail_cache_before_repair_when_current_cache_is_missing() {
        let root = unique_temp_root("repair-missing-current-cache");
        let db_path = root.join("images.db");
        let legacy_thumb = root
            .join("Local")
            .join(LEGACY_PRODUCTION_IDENTIFIER)
            .join(".thumbnails");
        let current_profile = root.join("Local").join(PRODUCTION_IDENTIFIER);
        let current_thumb = current_profile.join(".thumbnails");
        write_file(&current_profile.join("library.json"), "{}");
        write_file(&legacy_thumb.join("sample.webp"), "legacy-thumb");

        let legacy_path = legacy_thumb
            .join("sample.webp")
            .to_string_lossy()
            .to_string();
        let current_path = current_thumb
            .join("sample.webp")
            .to_string_lossy()
            .to_string();
        let conn = create_test_db(&db_path);
        insert_image_thumbnail(&conn, "img1", &legacy_path);
        drop(conn);

        let updated =
            repair_legacy_thumbnail_cache_and_paths(&db_path, &legacy_thumb, &current_thumb)
                .expect("thumbnail cache and DB repair should succeed")
                .expect("thumbnail path repair should run");

        assert_eq!(updated, 1);
        assert!(!legacy_thumb.exists());
        assert_eq!(
            fs::read_to_string(current_thumb.join("sample.webp"))
                .expect("moved thumbnail should exist"),
            "legacy-thumb"
        );
        let conn = rusqlite::Connection::open(&db_path).expect("test db should reopen");
        assert_eq!(image_thumbnail_path(&conn, "img1"), current_path);
        cleanup(&root);
    }

    #[test]
    fn merges_legacy_thumbnail_cache_without_overwriting_current_files_before_repair() {
        let root = unique_temp_root("repair-merge-current-cache");
        let db_path = root.join("images.db");
        let legacy_thumb = root
            .join("Local")
            .join(LEGACY_PRODUCTION_IDENTIFIER)
            .join(".thumbnails");
        let current_thumb = root
            .join("Local")
            .join(PRODUCTION_IDENTIFIER)
            .join(".thumbnails");
        write_file(&legacy_thumb.join("unique.webp"), "legacy-unique");
        write_file(&legacy_thumb.join("duplicate.webp"), "legacy-duplicate");
        write_file(&current_thumb.join("duplicate.webp"), "current-duplicate");

        let legacy_path = legacy_thumb
            .join("unique.webp")
            .to_string_lossy()
            .to_string();
        let current_path = current_thumb
            .join("unique.webp")
            .to_string_lossy()
            .to_string();
        let conn = create_test_db(&db_path);
        insert_image_thumbnail(&conn, "img1", &legacy_path);
        drop(conn);

        let updated =
            repair_legacy_thumbnail_cache_and_paths(&db_path, &legacy_thumb, &current_thumb)
                .expect("thumbnail cache and DB repair should succeed")
                .expect("thumbnail path repair should run");

        assert_eq!(updated, 1);
        assert_eq!(
            fs::read_to_string(current_thumb.join("unique.webp"))
                .expect("unique legacy thumbnail should be moved"),
            "legacy-unique"
        );
        assert_eq!(
            fs::read_to_string(current_thumb.join("duplicate.webp"))
                .expect("current duplicate thumbnail should remain"),
            "current-duplicate"
        );
        assert_eq!(
            fs::read_to_string(legacy_thumb.join("duplicate.webp"))
                .expect("skipped legacy duplicate should remain"),
            "legacy-duplicate"
        );
        let conn = rusqlite::Connection::open(&db_path).expect("test db should reopen");
        assert_eq!(image_thumbnail_path(&conn, "img1"), current_path);
        cleanup(&root);
    }

    #[test]
    fn skips_path_repair_when_no_thumbnail_cache_exists() {
        let root = unique_temp_root("repair-missing-caches");
        let db_path = root.join("images.db");
        let legacy_thumb = root
            .join("Local")
            .join(LEGACY_PRODUCTION_IDENTIFIER)
            .join(".thumbnails");
        let current_thumb = root
            .join("Local")
            .join(PRODUCTION_IDENTIFIER)
            .join(".thumbnails");
        let legacy_path = legacy_thumb
            .join("missing.webp")
            .to_string_lossy()
            .to_string();
        let conn = create_test_db(&db_path);
        insert_image_thumbnail(&conn, "img1", &legacy_path);
        drop(conn);

        let updated =
            repair_legacy_thumbnail_cache_and_paths(&db_path, &legacy_thumb, &current_thumb)
                .expect("missing thumbnail caches should skip path repair cleanly");

        assert_eq!(updated, None);
        assert!(!current_thumb.exists());
        let conn = rusqlite::Connection::open(&db_path).expect("test db should reopen");
        assert_eq!(image_thumbnail_path(&conn, "img1"), legacy_path);
        cleanup(&root);
    }
}
