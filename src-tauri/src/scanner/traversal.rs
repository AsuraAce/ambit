use super::models::FolderStats;
use std::path::Path;

pub fn scan_dir_recursive(root: &Path, current: &Path, stats: &mut FolderStats) {
    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if p.ends_with("thumbnails") {
                    if let Ok(sub_entries) = std::fs::read_dir(&p) {
                        for sub_entry in sub_entries.flatten() {
                            if sub_entry.path().is_file() {
                                stats.thumbnail_files += 1;
                            }
                        }
                    }
                } else {
                    scan_dir_recursive(root, &p, stats);
                }
            } else if p.is_file() {
                stats.total_files += 1;
                let ext = p
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
                    let is_thumbnail = p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.to_lowercase().ends_with("thumbnail.png"))
                        .unwrap_or(false);

                    if is_thumbnail {
                        stats.thumbnail_files += 1;
                    } else {
                        stats.image_files += 1;

                        if let Ok(rel) = p.strip_prefix(root) {
                            if let Some(parent) = rel.parent() {
                                let path_str = parent.to_string_lossy().to_string();
                                if !path_str.is_empty() {
                                    *stats.subfolders.entry(path_str).or_insert(0) += 1;
                                } else {
                                    *stats.subfolders.entry("root".to_string()).or_insert(0) += 1;
                                }
                            }
                        }
                    }
                } else {
                    stats.other_files += 1;
                }
            }
        }
    }
}

pub fn collect_images_recursive(
    root: &Path,
    current: &Path,
    files: &mut Vec<String>,
) {
    if files.len() > 300_000 {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if !p.ends_with("thumbnails") {
                    collect_images_recursive(root, &p, files);
                }
            } else if p.is_file() {
                let ext = p
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
                    let is_thumbnail = p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.to_lowercase().ends_with("thumbnail.png"))
                        .unwrap_or(false);

                    if !is_thumbnail {
                        if let Ok(rel) = p.strip_prefix(root) {
                            files.push(rel.to_string_lossy().replace("\\", "/"));
                        }
                    }
                }
            }
        }
    }
}

pub fn collect_images_recursive_absolute(
    root: &Path,
    current: &Path,
    files: &mut Vec<String>,
) {
    if files.len() > 300_000 {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if !p.ends_with("thumbnails") {
                    collect_images_recursive_absolute(root, &p, files);
                }
            } else if p.is_file() {
                let ext = p
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
                    let is_thumbnail = p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.to_lowercase().ends_with("thumbnail.png"))
                        .unwrap_or(false);

                    if !is_thumbnail {
                        files.push(p.to_string_lossy().replace("\\", "/"));
                    }
                }
            }
        }
    }
}

pub fn collect_images_with_stats_recursive(
    current: &Path,
    files: &mut Vec<super::models::FileEntry>,
) {
    if files.len() > 300_000 {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if !p.ends_with("thumbnails") {
                    collect_images_with_stats_recursive(&p, files);
                }
            } else if p.is_file() {
                let ext = p
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
                    let is_thumbnail = p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.to_lowercase().ends_with("thumbnail.png"))
                        .unwrap_or(false);

                    if !is_thumbnail {
                        let (size, modified) = match entry.metadata() {
                            Ok(m) => (
                                m.len(),
                                m.modified()
                                    .ok()
                                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_millis() as u64)
                                    .unwrap_or(0),
                            ),
                            Err(_) => (0, 0),
                        };

                        files.push(super::models::FileEntry {
                            path: p.to_string_lossy().replace("\\", "/"),
                            size,
                            modified,
                        });
                    }
                }
            }
        }
    }
}


