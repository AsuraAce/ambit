const PRODUCTION_IDENTIFIER: &str = "io.github.asuraace.ambit";
const LEGACY_PRODUCTION_IDENTIFIER: &str = "com.ambit.app";
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
    if let Some(config_dir) = dirs::config_dir() {
        let legacy_dir = config_dir.join(LEGACY_PRODUCTION_IDENTIFIER);
        let current_dir = config_dir.join(PRODUCTION_IDENTIFIER);
        let _ =
            migrate_identifier_dir(&legacy_dir, &current_dir, &["images.db"], "Roaming AppData");
    } else {
        eprintln!("[IdentifierMigration] Failed to resolve Roaming AppData config directory");
    }

    if let Some(data_local_dir) = dirs::data_local_dir() {
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
}
