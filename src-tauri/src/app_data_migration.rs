const PRODUCTION_IDENTIFIER: &str = "io.github.asuraace.ambit";
const LEGACY_PRODUCTION_IDENTIFIER: &str = "com.ambit.app";
#[cfg(not(test))]
const THUMBNAIL_PATH_REPAIR_MARKER: &str = ".thumbnail-path-repair-v1";
#[cfg(not(test))]
const APP_IDENTIFIER_PATHS: [&str; 5] = [
    PRODUCTION_IDENTIFIER,
    LEGACY_PRODUCTION_IDENTIFIER,
    "com.ambit.dev",
    "com.ambit.alpha",
    "com.tauri.dev",
];

#[derive(Debug, PartialEq, Eq)]
enum IdentifierMigrationOutcome {
    LegacyMissing,
    MovedLegacyDirectory,
    MergedLegacyEntries,
    SkippedExistingProfile,
    Failed,
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
    let mut paths_to_check = Vec::new();

    if let Some(config_dir) = dirs::config_dir() {
        push_identifier_dirs(&mut paths_to_check, &config_dir);
    }
    if let Some(data_local_dir) = dirs::data_local_dir() {
        push_identifier_dirs(&mut paths_to_check, &data_local_dir);
    }

    paths_to_check
}

#[cfg(not(test))]
fn push_identifier_dirs(paths: &mut Vec<std::path::PathBuf>, root: &std::path::Path) {
    for identifier in APP_IDENTIFIER_PATHS {
        paths.push(root.join(identifier));
    }
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
