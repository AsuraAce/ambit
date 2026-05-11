use serde::Serialize;
use specta::Type;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_DEPTH: usize = 4;
const IMAGE_LIMIT: usize = 300_000;

const VARIANT_A1111: &str = "Automatic1111";
const VARIANT_FORGE: &str = "Forge";
const VARIANT_SDNEXT: &str = "SD.Next";
const VARIANT_ANAPNOE: &str = "Anapnoe";
const VARIANT_UNKNOWN: &str = "Unknown";

const TYPE_TXT2IMG: &str = "txt2img";
const TYPE_IMG2IMG: &str = "img2img";
const TYPE_EXTRAS: &str = "extras";
const TYPE_GRID: &str = "grid";
const TYPE_SAVED: &str = "saved";
const TYPE_UNKNOWN: &str = "unknown";

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct A1111DiscoveryCandidate {
    pub path: String,
    pub name: String,
    pub image_count: usize,
    pub inferred_type: String,
    pub is_priority: bool,
    pub variant: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct A1111DiscoveryResult {
    pub detected_variant: String,
    pub candidates: Vec<A1111DiscoveryCandidate>,
    pub logs: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct ImageCount {
    count: usize,
    capped: bool,
}

#[derive(Debug)]
struct DirectoryListing {
    entries: Vec<PathBuf>,
    entry_errors: Vec<String>,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn discover_a1111_folders(root_path: String) -> Result<A1111DiscoveryResult, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(discover_a1111_folders_impl(&root_path)))
        .await
        .map_err(|e| e.to_string())?
}

fn discover_a1111_folders_impl(root_path: &str) -> A1111DiscoveryResult {
    let mut logs = Vec::new();
    let mut warnings = Vec::new();
    let root = PathBuf::from(root_path);
    let normalized_root = normalize_path(&root);

    log(&mut logs, format!("Starting scan of {normalized_root}"));
    let detected_variant = detect_webui_variation(&root, &mut logs, &mut warnings);
    log(
        &mut logs,
        format!("Detected Installation Type: {detected_variant}"),
    );

    let mut candidates = Vec::new();
    process_folder(
        &root,
        0,
        &detected_variant,
        &mut candidates,
        &mut logs,
        &mut warnings,
    );

    A1111DiscoveryResult {
        detected_variant,
        candidates,
        logs,
        warnings,
    }
}

fn detect_webui_variation(
    root_path: &Path,
    logs: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> String {
    let entries = match sorted_read_dir(root_path) {
        Ok(listing) => {
            push_entry_warnings(warnings, logs, listing.entry_errors);
            listing.entries
        }
        Err(error) => {
            push_warning(
                warnings,
                logs,
                format!(
                    "Could not inspect installation markers at {}: {}",
                    normalize_path(root_path),
                    error
                ),
            );
            return VARIANT_UNKNOWN.to_string();
        }
    };

    let file_names = entries
        .iter()
        .filter_map(|path| file_name_lower(path))
        .collect::<std::collections::HashSet<_>>();

    if file_names.contains("modules_forge") {
        return VARIANT_FORGE.to_string();
    }

    if let Some(readme_path) = entries
        .iter()
        .find(|path| file_name_lower(path).as_deref() == Some("readme.md"))
    {
        if let Ok(content) = std::fs::read_to_string(readme_path) {
            let lower_content = content
                .chars()
                .take(1000)
                .collect::<String>()
                .to_lowercase();
            if lower_content.contains("sd.next") || lower_content.contains("vladmandic") {
                return VARIANT_SDNEXT.to_string();
            }
            if lower_content.contains("forge") && lower_content.contains("webui") {
                return VARIANT_FORGE.to_string();
            }
            if lower_content.contains("anapnoe") {
                return VARIANT_ANAPNOE.to_string();
            }
        }
    }

    let mut modules_files = std::collections::HashSet::new();
    if file_names.contains("modules") {
        let modules_path = root_path.join("modules");
        match sorted_read_dir(&modules_path) {
            Ok(listing) => {
                push_entry_warnings(warnings, logs, listing.entry_errors);
                for path in listing.entries {
                    if let Some(name) = file_name_lower(&path) {
                        modules_files.insert(name);
                    }
                }
            }
            Err(error) => push_warning(
                warnings,
                logs,
                format!(
                    "Could not inspect module markers at {}: {}",
                    normalize_path(&modules_path),
                    error
                ),
            ),
        }
    }

    if modules_files.contains("forge_legacy.py") || file_names.contains("entry_with_update.py") {
        return VARIANT_FORGE.to_string();
    }

    if modules_files.contains("installer.py") || modules_files.contains("sd_next_impl.py") {
        return VARIANT_SDNEXT.to_string();
    }

    if file_names.contains("webui.py")
        || file_names.contains("webui.sh")
        || file_names.contains("webui.bat")
    {
        return VARIANT_A1111.to_string();
    }

    VARIANT_UNKNOWN.to_string()
}

fn process_folder(
    path: &Path,
    depth: usize,
    detected_variant: &str,
    candidates: &mut Vec<A1111DiscoveryCandidate>,
    logs: &mut Vec<String>,
    warnings: &mut Vec<String>,
) {
    if depth > MAX_DEPTH {
        return;
    }

    if is_thumbnails_dir(path) {
        return;
    }

    log(
        logs,
        format!("Processing: {} (Depth {depth})", normalize_path(path)),
    );

    let entries = match sorted_read_dir(path) {
        Ok(listing) => {
            push_entry_warnings(warnings, logs, listing.entry_errors);
            listing.entries
        }
        Err(error) => {
            push_warning(
                warnings,
                logs,
                format!("Could not read {}: {}", normalize_path(path), error),
            );
            return;
        }
    };

    let mut direct_image_count = 0usize;
    let mut subdirs = Vec::new();

    for entry_path in &entries {
        if entry_path.is_dir() {
            if let Some(lower_name) = file_name_lower(entry_path) {
                if !is_ignored_discovery_dir(&lower_name) {
                    subdirs.push(entry_path.clone());
                }
            }
        } else if is_importable_image_file(entry_path) {
            direct_image_count += 1;
        }
    }

    let subdir_names = if subdirs.is_empty() {
        ".".to_string()
    } else {
        subdirs
            .iter()
            .filter_map(|path| path.file_name().and_then(|name| name.to_str()))
            .map(|name| name.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    };
    log(
        logs,
        format!(
            "  Found {} entries. Subdirs: {}. Direct Images: {}",
            entries.len(),
            subdir_names,
            direct_image_count
        ),
    );

    let normalized_path = normalize_path(path);
    let inferred_type = infer_type_from_path(&normalized_path).to_string();
    let is_priority = inferred_type != TYPE_UNKNOWN;

    if is_priority {
        let total = count_images_recursive(path, IMAGE_LIMIT, warnings, logs);
        if total.count > 0 {
            candidates.push(A1111DiscoveryCandidate {
                path: normalized_path,
                name: folder_name(path),
                image_count: total.count,
                inferred_type,
                is_priority: true,
                variant: detected_variant.to_string(),
            });
            let cap_detail = if total.capped { " (capped)" } else { "" };
            log(
                logs,
                format!(
                    "  -> Added Priority: {} (Images: {}{})",
                    normalize_path(path),
                    total.count,
                    cap_detail
                ),
            );
        } else {
            log(
                logs,
                format!("  -> Skipped Priority (Empty): {}", normalize_path(path)),
            );
        }
        return;
    }

    let has_priority_deep = subdirs.iter().any(|subdir| {
        let sub_type = infer_type_from_path(&normalize_path(subdir));
        if sub_type != TYPE_UNKNOWN {
            log(
                logs,
                format!(
                    "  -> Has Priority Deep: {} is {}",
                    folder_name(subdir),
                    sub_type
                ),
            );
            true
        } else {
            false
        }
    });

    if !has_priority_deep && depth > 0 {
        let total = count_images_recursive(path, IMAGE_LIMIT, warnings, logs);
        if total.count > 0 {
            candidates.push(A1111DiscoveryCandidate {
                path: normalized_path,
                name: folder_name(path),
                image_count: total.count,
                inferred_type: TYPE_UNKNOWN.to_string(),
                is_priority: false,
                variant: detected_variant.to_string(),
            });
            let cap_detail = if total.capped { " (capped)" } else { "" };
            log(
                logs,
                format!(
                    "  -> Added Consolidated: {} (Images: {}{})",
                    normalize_path(path),
                    total.count,
                    cap_detail
                ),
            );
            return;
        }

        log(
            logs,
            format!(
                "  -> Skipped Consolidated (No Images): {}",
                normalize_path(path)
            ),
        );
    } else if has_priority_deep {
        log(logs, "  -> Recursing (Has Priority Deep)".to_string());
    } else if depth == 0 {
        log(logs, "  -> Recursing (Root)".to_string());
    }

    for subdir in subdirs {
        process_folder(
            &subdir,
            depth + 1,
            detected_variant,
            candidates,
            logs,
            warnings,
        );
    }
}

fn count_images_recursive(
    root: &Path,
    limit: usize,
    warnings: &mut Vec<String>,
    logs: &mut Vec<String>,
) -> ImageCount {
    let mut count = 0usize;
    let mut pending_dirs = vec![root.to_path_buf()];
    let mut capped = false;

    while let Some(current) = pending_dirs.pop() {
        if count >= limit {
            capped = true;
            break;
        }

        let entries = match sorted_read_dir(&current) {
            Ok(listing) => {
                push_entry_warnings(warnings, logs, listing.entry_errors);
                listing.entries
            }
            Err(error) => {
                push_warning(
                    warnings,
                    logs,
                    format!("Could not read {}: {}", normalize_path(&current), error),
                );
                continue;
            }
        };

        for entry_path in entries {
            if count >= limit {
                capped = true;
                break;
            }

            if entry_path.is_dir() {
                if !is_thumbnails_dir(&entry_path) {
                    pending_dirs.push(entry_path);
                }
            } else if is_importable_image_file(&entry_path) {
                count += 1;
            }
        }
    }

    if capped {
        push_warning(
            warnings,
            logs,
            format!(
                "Image count for {} reached the {} file scan cap",
                normalize_path(root),
                limit
            ),
        );
    }

    ImageCount { count, capped }
}

fn sorted_read_dir(path: &Path) -> std::io::Result<DirectoryListing> {
    let mut entries = Vec::new();
    let mut entry_errors = Vec::new();

    for entry in std::fs::read_dir(path)? {
        match entry {
            Ok(entry) => entries.push(entry.path()),
            Err(error) => entry_errors.push(format!(
                "Could not read entry in {}: {}",
                normalize_path(path),
                error
            )),
        }
    }

    entries.sort_by_key(|path| normalize_path(path).to_lowercase());
    Ok(DirectoryListing {
        entries,
        entry_errors,
    })
}

fn infer_type_from_path(path: &str) -> &'static str {
    let normalized = path.replace('\\', "/").to_lowercase();
    if normalized.contains("txt2img-grids") || normalized.contains("img2img-grids") {
        return TYPE_GRID;
    }

    let parts = normalized.split('/').collect::<Vec<_>>();
    if parts
        .iter()
        .any(|part| matches!(*part, "txt2img-images" | "txt2img" | "text"))
    {
        return TYPE_TXT2IMG;
    }
    if parts
        .iter()
        .any(|part| matches!(*part, "img2img-images" | "img2img" | "image"))
    {
        return TYPE_IMG2IMG;
    }
    if parts
        .iter()
        .any(|part| matches!(*part, "extras-images" | "extras" | "upscale"))
    {
        return TYPE_EXTRAS;
    }
    if parts
        .iter()
        .any(|part| matches!(*part, "grids" | "grids-images"))
    {
        return TYPE_GRID;
    }
    if parts.iter().any(|part| matches!(*part, "save" | "saved")) {
        return TYPE_SAVED;
    }

    TYPE_UNKNOWN
}

fn is_ignored_discovery_dir(lower_name: &str) -> bool {
    matches!(
        lower_name,
        "venv"
            | "scripts"
            | "extensions"
            | "models"
            | "embeddings"
            | "tmp"
            | "cache"
            | ".git"
            | "thumbnails"
    )
}

fn is_importable_image_file(path: &Path) -> bool {
    if is_thumbnail_file(path) {
        return false;
    }

    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp"))
        .unwrap_or(false)
}

fn is_thumbnail_file(path: &Path) -> bool {
    file_name_lower(path)
        .map(|name| name.ends_with("thumbnail.png"))
        .unwrap_or(false)
}

fn is_thumbnails_dir(path: &Path) -> bool {
    file_name_lower(path)
        .map(|name| name == "thumbnails")
        .unwrap_or(false)
}

fn file_name_lower(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_lowercase())
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn log(logs: &mut Vec<String>, message: String) {
    logs.push(format!("[{}] {}", current_time_label(), message));
}

fn push_warning(warnings: &mut Vec<String>, logs: &mut Vec<String>, message: String) {
    warnings.push(message.clone());
    log(logs, format!("  ! Warning: {message}"));
}

fn push_entry_warnings(
    warnings: &mut Vec<String>,
    logs: &mut Vec<String>,
    entry_errors: Vec<String>,
) {
    for entry_error in entry_errors {
        push_warning(warnings, logs, entry_error);
    }
}

fn current_time_label() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() % 86_400)
        .unwrap_or(0);
    let hour_24 = secs / 3600;
    let minute = (secs % 3600) / 60;
    let second = secs % 60;
    let suffix = if hour_24 >= 12 { "PM" } else { "AM" };
    let hour_12 = match hour_24 % 12 {
        0 => 12,
        hour => hour,
    };
    format!("{hour_12}:{minute:02}:{second:02} {suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_discovery_dir(test_name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ambit_a1111_{test_name}_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_file(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"image").unwrap();
    }

    #[test]
    fn sorted_read_dir_returns_sorted_entries_without_entry_errors() {
        let root = temp_discovery_dir("sorted_read_dir");
        write_file(&root.join("b.png"));
        write_file(&root.join("a.png"));
        fs::create_dir_all(root.join("z-folder")).unwrap();

        let listing = sorted_read_dir(&root).unwrap();
        let names = listing
            .entries
            .iter()
            .map(|entry| entry.file_name().unwrap().to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["a.png", "b.png", "z-folder"]);
        assert!(listing.entry_errors.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn discovers_standard_date_subfolder_outputs() {
        let root = temp_discovery_dir("date_outputs").join("outputs");
        write_file(&root.join("img2img-images/2023-04-20/00001.png"));
        write_file(&root.join("txt2img/00002.jpg"));
        write_file(&root.join("txt2img-images/2023-04-20/00003.webp"));

        let result = discover_a1111_folders_impl(&root.to_string_lossy());

        let names = result
            .candidates
            .iter()
            .map(|candidate| {
                (
                    candidate.name.as_str(),
                    candidate.inferred_type.as_str(),
                    candidate.image_count,
                    candidate.is_priority,
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                ("img2img-images", TYPE_IMG2IMG, 1, true),
                ("txt2img", TYPE_TXT2IMG, 1, true),
                ("txt2img-images", TYPE_TXT2IMG, 1, true),
            ]
        );
        assert!(result.warnings.is_empty());

        let _ = fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn thumbnail_files_and_thumbnail_dirs_are_not_counted() {
        let root = temp_discovery_dir("thumbnail_skip").join("outputs");
        write_file(&root.join("txt2img-images/2023-04-20/00001.png"));
        write_file(&root.join("txt2img-images/2023-04-20/00001.thumbnail.png"));
        write_file(&root.join("txt2img-images/thumbnails/preview.png"));

        let result = discover_a1111_folders_impl(&root.to_string_lossy());

        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].name, "txt2img-images");
        assert_eq!(result.candidates[0].image_count, 1);

        let _ = fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn custom_folders_with_images_are_non_priority_candidates() {
        let root = temp_discovery_dir("custom_folder").join("outputs");
        write_file(&root.join("custom-archive/2024-01-01/00001.png"));

        let result = discover_a1111_folders_impl(&root.to_string_lossy());

        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].name, "custom-archive");
        assert_eq!(result.candidates[0].inferred_type, TYPE_UNKNOWN);
        assert!(!result.candidates[0].is_priority);
        assert_eq!(result.candidates[0].image_count, 1);

        let _ = fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn empty_priority_folders_are_skipped() {
        let root = temp_discovery_dir("empty_priority").join("outputs");
        fs::create_dir_all(root.join("txt2img-images/2023-04-20")).unwrap();

        let result = discover_a1111_folders_impl(&root.to_string_lossy());

        assert!(result.candidates.is_empty());
        assert!(result
            .logs
            .iter()
            .any(|entry| entry.contains("Skipped Priority (Empty)")));

        let _ = fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn recursive_count_reports_scan_cap_warning() {
        let root = temp_discovery_dir("cap_warning");
        write_file(&root.join("one.png"));
        write_file(&root.join("two.png"));
        write_file(&root.join("three.png"));
        let mut warnings = Vec::new();
        let mut logs = Vec::new();

        let result = count_images_recursive(&root, 2, &mut warnings, &mut logs);

        assert_eq!(result.count, 2);
        assert!(result.capped);
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("scan cap"));

        let _ = fs::remove_dir_all(root);
    }
}
