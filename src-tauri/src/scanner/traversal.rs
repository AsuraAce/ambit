use super::models::{FileEntry, FolderStats};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const IMAGE_EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

fn canonical_root(root: &Path) -> Option<PathBuf> {
    root.canonicalize().ok()
}

fn canonical_inside_root(root: &Path, path: &Path) -> Option<PathBuf> {
    let canonical = path.canonicalize().ok()?;
    if canonical.starts_with(root) {
        Some(canonical)
    } else {
        None
    }
}

fn is_thumbnail_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("thumbnails"))
        .unwrap_or(false)
}

fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|ext| IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_thumbnail_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_lowercase().ends_with("thumbnail.png"))
        .unwrap_or(false)
}

fn safe_file(root: &Path, path: &Path, file_type: std::fs::FileType) -> bool {
    !file_type.is_symlink() && file_type.is_file() && canonical_inside_root(root, path).is_some()
}

fn safe_dir(root: &Path, path: &Path, file_type: std::fs::FileType) -> bool {
    !file_type.is_symlink() && file_type.is_dir() && canonical_inside_root(root, path).is_some()
}

pub fn scan_dir_recursive(root: &Path, current: &Path, stats: &mut FolderStats) {
    let Some(root_canonical) = canonical_root(root) else {
        return;
    };
    let mut visited = HashSet::new();
    scan_dir_recursive_inner(root, &root_canonical, current, stats, &mut visited);
}

fn scan_dir_recursive_inner(
    root: &Path,
    root_canonical: &Path,
    current: &Path,
    stats: &mut FolderStats,
    visited: &mut HashSet<PathBuf>,
) {
    let Some(current_canonical) = canonical_inside_root(root_canonical, current) else {
        return;
    };
    if !visited.insert(current_canonical) {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if safe_dir(root_canonical, &p, file_type) {
                if is_thumbnail_dir(&p) {
                    if let Ok(sub_entries) = std::fs::read_dir(&p) {
                        for sub_entry in sub_entries.flatten() {
                            let sub_path = sub_entry.path();
                            if let Ok(sub_type) = sub_entry.file_type() {
                                if safe_file(root_canonical, &sub_path, sub_type) {
                                    stats.thumbnail_files += 1;
                                }
                            }
                        }
                    }
                } else {
                    scan_dir_recursive_inner(root, root_canonical, &p, stats, visited);
                }
            } else if safe_file(root_canonical, &p, file_type) {
                stats.total_files += 1;
                if is_image_path(&p) {
                    if is_thumbnail_file(&p) {
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

pub fn collect_images_recursive(root: &Path, current: &Path, files: &mut Vec<String>) {
    let Some(root_canonical) = canonical_root(root) else {
        return;
    };
    let mut visited = HashSet::new();
    collect_images_recursive_inner(root, &root_canonical, current, files, &mut visited);
}

fn collect_images_recursive_inner(
    root: &Path,
    root_canonical: &Path,
    current: &Path,
    files: &mut Vec<String>,
    visited: &mut HashSet<PathBuf>,
) {
    if files.len() > 300_000 {
        return;
    }

    let Some(current_canonical) = canonical_inside_root(root_canonical, current) else {
        return;
    };
    if !visited.insert(current_canonical) {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if safe_dir(root_canonical, &p, file_type) {
                if !is_thumbnail_dir(&p) {
                    collect_images_recursive_inner(root, root_canonical, &p, files, visited);
                }
            } else if safe_file(root_canonical, &p, file_type)
                && is_image_path(&p)
                && !is_thumbnail_file(&p)
            {
                if let Ok(rel) = p.strip_prefix(root) {
                    files.push(rel.to_string_lossy().replace("\\", "/"));
                }
            }
        }
    }
}

pub fn collect_images_recursive_absolute(root: &Path, current: &Path, files: &mut Vec<String>) {
    let Some(root_canonical) = canonical_root(root) else {
        return;
    };
    let mut visited = HashSet::new();
    collect_images_recursive_absolute_inner(&root_canonical, current, files, &mut visited);
}

fn collect_images_recursive_absolute_inner(
    root_canonical: &Path,
    current: &Path,
    files: &mut Vec<String>,
    visited: &mut HashSet<PathBuf>,
) {
    if files.len() > 300_000 {
        return;
    }

    let Some(current_canonical) = canonical_inside_root(root_canonical, current) else {
        return;
    };
    if !visited.insert(current_canonical) {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if safe_dir(root_canonical, &p, file_type) {
                if !is_thumbnail_dir(&p) {
                    collect_images_recursive_absolute_inner(root_canonical, &p, files, visited);
                }
            } else if safe_file(root_canonical, &p, file_type)
                && is_image_path(&p)
                && !is_thumbnail_file(&p)
            {
                files.push(p.to_string_lossy().replace("\\", "/"));
            }
        }
    }
}

pub fn collect_images_with_stats_recursive(current: &Path, files: &mut Vec<FileEntry>) {
    let Some(root_canonical) = canonical_root(current) else {
        return;
    };
    let mut visited = HashSet::new();
    collect_images_with_stats_recursive_inner(&root_canonical, current, files, &mut visited);
}

fn collect_images_with_stats_recursive_inner(
    root_canonical: &Path,
    current: &Path,
    files: &mut Vec<FileEntry>,
    visited: &mut HashSet<PathBuf>,
) {
    if files.len() > 300_000 {
        return;
    }

    let Some(current_canonical) = canonical_inside_root(root_canonical, current) else {
        return;
    };
    if !visited.insert(current_canonical) {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if safe_dir(root_canonical, &p, file_type) {
                if !is_thumbnail_dir(&p) {
                    collect_images_with_stats_recursive_inner(root_canonical, &p, files, visited);
                }
            } else if safe_file(root_canonical, &p, file_type)
                && is_image_path(&p)
                && !is_thumbnail_file(&p)
            {
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

                files.push(FileEntry {
                    path: p.to_string_lossy().replace("\\", "/"),
                    size,
                    modified,
                });
            }
        }
    }
}

pub fn collect_images_with_stats_since_recursive(
    current: &Path,
    since_timestamp: u64, // Unix millis
    files: &mut Vec<FileEntry>,
) {
    let Some(root_canonical) = canonical_root(current) else {
        return;
    };
    let mut visited = HashSet::new();
    collect_images_with_stats_since_recursive_inner(
        &root_canonical,
        current,
        since_timestamp,
        files,
        &mut visited,
    );
}

fn collect_images_with_stats_since_recursive_inner(
    root_canonical: &Path,
    current: &Path,
    since_timestamp: u64,
    files: &mut Vec<FileEntry>,
    visited: &mut HashSet<PathBuf>,
) {
    if files.len() > 300_000 {
        return;
    }

    let Some(current_canonical) = canonical_inside_root(root_canonical, current) else {
        return;
    };
    if !visited.insert(current_canonical) {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if safe_dir(root_canonical, &p, file_type) {
                if !is_thumbnail_dir(&p) {
                    collect_images_with_stats_since_recursive_inner(
                        root_canonical,
                        &p,
                        since_timestamp,
                        files,
                        visited,
                    );
                }
            } else if safe_file(root_canonical, &p, file_type)
                && is_image_path(&p)
                && !is_thumbnail_file(&p)
            {
                let (size, modified, created) = match entry.metadata() {
                    Ok(m) => {
                        let mtime = m
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0);
                        let ctime = m
                            .created()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0);
                        (m.len(), mtime, ctime)
                    }
                    Err(_) => (0, 0, 0),
                };

                if modified > since_timestamp || created > since_timestamp {
                    files.push(FileEntry {
                        path: p.to_string_lossy().replace("\\", "/"),
                        size,
                        modified: modified.max(created),
                    });
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock is available")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "ambit-scanner-{name}-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("temp dir can be created");
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn write_file(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent dir can be created");
        }
        fs::write(path, b"image").expect("test file can be written");
    }

    fn normalized(path: &Path) -> String {
        path.to_string_lossy().replace("\\", "/")
    }

    #[cfg(unix)]
    fn symlink_dir(target: &Path, link: &Path) -> io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[cfg(windows)]
    fn symlink_dir(target: &Path, link: &Path) -> io::Result<()> {
        std::os::windows::fs::symlink_dir(target, link)
    }

    #[cfg(unix)]
    fn symlink_file(target: &Path, link: &Path) -> io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[cfg(windows)]
    fn symlink_file(target: &Path, link: &Path) -> io::Result<()> {
        std::os::windows::fs::symlink_file(target, link)
    }

    #[test]
    fn traversal_skips_current_paths_outside_root() {
        let root = TestDir::new("root");
        let outside = TestDir::new("outside");
        write_file(&outside.path.join("outside.png"));

        let mut stats = FolderStats::default();
        scan_dir_recursive(&root.path, &outside.path, &mut stats);
        assert_eq!(stats.image_files, 0);

        let mut relative = Vec::new();
        collect_images_recursive(&root.path, &outside.path, &mut relative);
        assert!(relative.is_empty());

        let mut absolute = Vec::new();
        collect_images_recursive_absolute(&root.path, &outside.path, &mut absolute);
        assert!(absolute.is_empty());
    }

    #[test]
    fn traversal_skips_linked_outside_entries_for_all_scanners() {
        let root = TestDir::new("linked-root");
        let outside = TestDir::new("linked-outside");

        let inside = root.path.join("inside.png");
        let nested = root.path.join("nested").join("inner.webp");
        let outside_image = outside.path.join("outside.png");
        write_file(&inside);
        write_file(&nested);
        write_file(&outside_image);

        let linked_dir = root.path.join("linked-outside");
        let linked_file = root.path.join("linked-file.png");
        let _ = symlink_dir(&outside.path, &linked_dir);
        let _ = symlink_file(&outside_image, &linked_file);

        let mut stats = FolderStats::default();
        scan_dir_recursive(&root.path, &root.path, &mut stats);
        assert_eq!(stats.image_files, 2);

        let mut relative = Vec::new();
        collect_images_recursive(&root.path, &root.path, &mut relative);
        relative.sort();
        assert_eq!(relative, vec!["inside.png", "nested/inner.webp"]);

        let expected_absolute = {
            let mut values = vec![normalized(&inside), normalized(&nested)];
            values.sort();
            values
        };

        let mut absolute = Vec::new();
        collect_images_recursive_absolute(&root.path, &root.path, &mut absolute);
        absolute.sort();
        assert_eq!(absolute, expected_absolute);

        let mut with_stats = Vec::new();
        collect_images_with_stats_recursive(&root.path, &mut with_stats);
        let mut with_stats_paths: Vec<_> = with_stats.iter().map(|entry| entry.path.clone()).collect();
        with_stats_paths.sort();
        assert_eq!(with_stats_paths, expected_absolute);

        let mut since = Vec::new();
        collect_images_with_stats_since_recursive(&root.path, 0, &mut since);
        let mut since_paths: Vec<_> = since.iter().map(|entry| entry.path.clone()).collect();
        since_paths.sort();
        assert_eq!(since_paths, expected_absolute);
    }
}
