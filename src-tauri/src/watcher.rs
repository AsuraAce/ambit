use notify::event::{ModifyKind, RenameMode};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{BTreeMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri_specta::Event as SpectaEvent;

const WATCHER_THROTTLE_MS: u64 = 1_000;
const WATCHER_TIMEOUT_MS: u64 = 250;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum FolderChangeKind {
    Create,
    Modify,
    Rename,
    Remove,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FolderChange {
    pub kind: FolderChangeKind,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
enum BufferedFolderChange {
    Ready(FolderChange),
    RenameFrom(String),
    RenameTo(String),
}

#[derive(Clone, Debug, Deserialize, Serialize, Type, tauri_specta::Event)]
pub struct FolderChangeEvent(pub Vec<FolderChange>);

fn path_extension_label(path: &str) -> String {
    let lower = path.to_lowercase();
    if lower.ends_with(".db-wal") {
        return "db-wal".to_string();
    }

    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .filter(|ext| !ext.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

fn summarize_path_types(paths: &[String]) -> String {
    let mut counts = BTreeMap::new();

    for path in paths {
        let ext = path_extension_label(path);
        *counts.entry(ext).or_insert(0usize) += 1;
    }

    counts
        .into_iter()
        .map(|(ext, count)| format!("{ext}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn is_target_path(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_lowercase);
    let is_target = extension.as_deref().is_some_and(|ext| {
        [
            "png", "jpg", "jpeg", "webp", "mp4", "webm", "mov", "m4v", "mkv", "db", "db-wal",
        ]
        .contains(&ext)
    });
    let is_thumbnail = path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.to_lowercase().ends_with("thumbnail.png"));

    is_target && !is_thumbnail
}

fn change(
    kind: FolderChangeKind,
    paths: impl IntoIterator<Item = PathBuf>,
) -> Option<FolderChange> {
    let paths = paths
        .into_iter()
        .filter(|path| is_target_path(path))
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();

    (!paths.is_empty()).then_some(FolderChange { kind, paths })
}

fn normalize_notify_event(event: notify::Event) -> Vec<FolderChange> {
    let paths = event.paths;
    match event.kind {
        EventKind::Create(_) => change(FolderChangeKind::Create, paths)
            .into_iter()
            .collect(),
        EventKind::Remove(_) => change(FolderChangeKind::Remove, paths)
            .into_iter()
            .collect(),
        EventKind::Modify(ModifyKind::Name(mode)) => {
            if paths.len() >= 2 {
                let old_path = paths.first().cloned().expect("rename has an old path");
                let new_path = paths.last().cloned().expect("rename has a new path");
                return match (is_target_path(&old_path), is_target_path(&new_path)) {
                    (true, true) => vec![FolderChange {
                        kind: FolderChangeKind::Rename,
                        paths: vec![
                            old_path.to_string_lossy().to_string(),
                            new_path.to_string_lossy().to_string(),
                        ],
                    }],
                    (true, false) => change(FolderChangeKind::Remove, [old_path])
                        .into_iter()
                        .collect(),
                    (false, true) => change(FolderChangeKind::Create, [new_path])
                        .into_iter()
                        .collect(),
                    (false, false) => Vec::new(),
                };
            }

            let kind = match mode {
                RenameMode::From => FolderChangeKind::Remove,
                RenameMode::To => FolderChangeKind::Create,
                _ => FolderChangeKind::Modify,
            };
            change(kind, paths).into_iter().collect()
        }
        EventKind::Modify(_)
        | EventKind::Access(notify::event::AccessKind::Close(_))
        | EventKind::Any => change(FolderChangeKind::Modify, paths)
            .into_iter()
            .collect(),
        _ => Vec::new(),
    }
}

fn normalize_notify_event_for_buffer(event: notify::Event) -> Vec<BufferedFolderChange> {
    match event.kind {
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => event
            .paths
            .into_iter()
            .filter(|path| is_target_path(path))
            .map(|path| BufferedFolderChange::RenameFrom(path.to_string_lossy().to_string()))
            .collect(),
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => event
            .paths
            .into_iter()
            .filter(|path| is_target_path(path))
            .map(|path| BufferedFolderChange::RenameTo(path.to_string_lossy().to_string()))
            .collect(),
        _ => normalize_notify_event(event)
            .into_iter()
            .map(BufferedFolderChange::Ready)
            .collect(),
    }
}

fn coalesce_buffered_changes(
    changes: impl IntoIterator<Item = BufferedFolderChange>,
) -> Vec<FolderChange> {
    let mut pending_rename_sources = VecDeque::new();
    let mut resolved = Vec::new();

    for change in changes {
        match change {
            BufferedFolderChange::Ready(change) => resolved.push(change),
            BufferedFolderChange::RenameFrom(path) => pending_rename_sources.push_back(path),
            BufferedFolderChange::RenameTo(path) => {
                if let Some(old_path) = pending_rename_sources.pop_front() {
                    resolved.push(FolderChange {
                        kind: FolderChangeKind::Rename,
                        paths: vec![old_path, path],
                    });
                } else {
                    resolved.push(FolderChange {
                        kind: FolderChangeKind::Create,
                        paths: vec![path],
                    });
                }
            }
        }
    }

    resolved.extend(pending_rename_sources.into_iter().map(|path| FolderChange {
        kind: FolderChangeKind::Remove,
        paths: vec![path],
    }));

    let mut seen = HashSet::new();
    resolved
        .into_iter()
        .filter(|change| seen.insert(change.clone()))
        .collect()
}

pub struct WatcherState {
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    pub _last_event: Mutex<Instant>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            watcher: Mutex::new(None),
            _last_event: Mutex::new(Instant::now().checked_sub(Duration::from_secs(10)).unwrap()),
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn start_native_folder_watcher(
    app: tauri::AppHandle,
    paths: Vec<String>,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    if paths.is_empty() {
        let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;
        if watcher_guard.is_some() {
            *watcher_guard = None;
            log::info!("[Rust Watcher] Stopped watcher");
        }
        return Ok(());
    }

    let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;

    if watcher_guard.is_some() {
        *watcher_guard = None;
        log::info!("[Rust Watcher] Restarting watcher with new paths...");
    }

    let app_handle = app.clone();

    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<BufferedFolderChange>>(1000);

    tauri::async_runtime::spawn(async move {
        let mut buffer = Vec::new();
        let mut first_event_time: Option<tokio::time::Instant> = None;
        let throttle_duration = tokio::time::Duration::from_millis(WATCHER_THROTTLE_MS);

        loop {
            match tokio::time::timeout(
                tokio::time::Duration::from_millis(WATCHER_TIMEOUT_MS),
                rx.recv(),
            )
            .await
            {
                Ok(Some(changes)) => {
                    buffer.extend(changes);
                    if first_event_time.is_none() {
                        first_event_time = Some(tokio::time::Instant::now());
                    } else if first_event_time
                        .map(|started_at| started_at.elapsed() >= throttle_duration)
                        .unwrap_or(false)
                    {
                        let batch_age_ms = first_event_time
                            .map(|started_at| started_at.elapsed().as_millis())
                            .unwrap_or(0);
                        let to_emit = coalesce_buffered_changes(buffer.drain(..));
                        let emitted_paths = to_emit
                            .iter()
                            .flat_map(|change| change.paths.iter().cloned())
                            .collect::<Vec<_>>();
                        log::info!(
                            "[LiveWatchPerf] watcher batch emitted | reason=throttle | changes={} | paths={} | age_ms={} | types={}",
                            to_emit.len(),
                            emitted_paths.len(),
                            batch_age_ms,
                            summarize_path_types(&emitted_paths)
                        );
                        let _ = FolderChangeEvent(to_emit).emit(&app_handle);
                        first_event_time = None;
                    }
                }
                Ok(None) => break, // Channel closed
                Err(_) => {
                    // Timeout elapsed
                    if !buffer.is_empty() {
                        let batch_age_ms = first_event_time
                            .map(|started_at| started_at.elapsed().as_millis())
                            .unwrap_or(0);
                        let to_emit = coalesce_buffered_changes(buffer.drain(..));
                        let emitted_paths = to_emit
                            .iter()
                            .flat_map(|change| change.paths.iter().cloned())
                            .collect::<Vec<_>>();
                        log::info!(
                            "[LiveWatchPerf] watcher batch emitted | reason=timeout | changes={} | paths={} | age_ms={} | types={}",
                            to_emit.len(),
                            emitted_paths.len(),
                            batch_age_ms,
                            summarize_path_types(&emitted_paths)
                        );
                        let _ = FolderChangeEvent(to_emit).emit(&app_handle);
                        first_event_time = None;
                    }
                }
            }
        }
    });

    let event_handler = move |res: notify::Result<notify::Event>| match res {
        Ok(event) => {
            let raw_path_count = event.paths.len();
            let event_kind = format!("{:?}", event.kind);
            let changes = normalize_notify_event_for_buffer(event);
            if !changes.is_empty() {
                let valid_paths = changes
                    .iter()
                    .flat_map(|change| match change {
                        BufferedFolderChange::Ready(change) => change.paths.clone(),
                        BufferedFolderChange::RenameFrom(path)
                        | BufferedFolderChange::RenameTo(path) => vec![path.clone()],
                    })
                    .collect::<Vec<_>>();
                log::info!(
                        "[LiveWatchPerf] watcher event received | kind={} | raw_paths={} | matched_changes={} | matched_paths={} | types={}",
                        event_kind,
                        raw_path_count,
                        changes.len(),
                        valid_paths.len(),
                        summarize_path_types(&valid_paths)
                    );
                let _ = tx.blocking_send(changes);
            }
        }
        Err(e) => log::error!("[Rust Watcher] watch error: {:?}", e),
    };

    let mut watcher =
        RecommendedWatcher::new(event_handler, Config::default()).map_err(|e| e.to_string())?;

    let mut errors = Vec::new();
    for path_str in &paths {
        let path_buf = PathBuf::from(path_str);
        if path_buf.exists() {
            if let Err(e) = watcher.watch(&path_buf, RecursiveMode::Recursive) {
                let err_msg = format!("Failed to watch path {}: {}", path_str, e);
                log::error!("[Rust Watcher] {}", err_msg);
                errors.push(err_msg);
            } else {
                log::info!("[Rust Watcher] Added path: {}", path_str);
            }
        } else {
            log::warn!("[Rust Watcher] Skipping non-existent path: {}", path_str);
        }
    }

    *watcher_guard = Some(watcher);

    if !errors.is_empty() {
        return Err(errors.join("\n"));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind, RemoveKind};

    #[test]
    fn normalizes_supported_video_create_and_modify_events() {
        let create = normalize_notify_event(
            notify::Event::new(EventKind::Create(CreateKind::File))
                .add_path(PathBuf::from("C:/library/clip.mp4")),
        );
        let modify = normalize_notify_event(
            notify::Event::new(EventKind::Modify(ModifyKind::Data(
                notify::event::DataChange::Content,
            )))
            .add_path(PathBuf::from("C:/library/clip.webm")),
        );

        assert_eq!(create[0].kind, FolderChangeKind::Create);
        assert_eq!(create[0].paths, vec!["C:/library/clip.mp4"]);
        assert_eq!(modify[0].kind, FolderChangeKind::Modify);
        assert_eq!(modify[0].paths, vec!["C:/library/clip.webm"]);
    }

    #[test]
    fn preserves_supported_rename_pairs_and_classifies_extension_changes() {
        let rename = normalize_notify_event(
            notify::Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
                .add_path(PathBuf::from("C:/library/old.mov"))
                .add_path(PathBuf::from("C:/library/new.mov")),
        );
        let removed_by_rename = normalize_notify_event(
            notify::Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
                .add_path(PathBuf::from("C:/library/old.mkv"))
                .add_path(PathBuf::from("C:/library/old.txt")),
        );

        assert_eq!(rename[0].kind, FolderChangeKind::Rename);
        assert_eq!(
            rename[0].paths,
            vec!["C:/library/old.mov", "C:/library/new.mov"]
        );
        assert_eq!(removed_by_rename[0].kind, FolderChangeKind::Remove);
        assert_eq!(removed_by_rename[0].paths, vec!["C:/library/old.mkv"]);
    }

    #[test]
    fn coalesces_split_windows_rename_events_without_pairing_ordinary_changes() {
        let rename_from = normalize_notify_event_for_buffer(
            notify::Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::From)))
                .add_path(PathBuf::from("C:/library/old.webm")),
        );
        let rename_to = normalize_notify_event_for_buffer(
            notify::Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::To)))
                .add_path(PathBuf::from("C:/library/new.webm")),
        );
        let ordinary_create = normalize_notify_event_for_buffer(
            notify::Event::new(EventKind::Create(CreateKind::File))
                .add_path(PathBuf::from("C:/library/other.mp4")),
        );

        let changes = coalesce_buffered_changes(
            rename_from
                .into_iter()
                .chain(rename_to)
                .chain(ordinary_create),
        );

        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].kind, FolderChangeKind::Rename);
        assert_eq!(
            changes[0].paths,
            vec!["C:/library/old.webm", "C:/library/new.webm"]
        );
        assert_eq!(changes[1].kind, FolderChangeKind::Create);
        assert_eq!(changes[1].paths, vec!["C:/library/other.mp4"]);
    }

    #[test]
    fn preserves_unmatched_split_rename_fragments_as_remove_or_create() {
        let removed = coalesce_buffered_changes(normalize_notify_event_for_buffer(
            notify::Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::From)))
                .add_path(PathBuf::from("C:/library/moved-out.mkv")),
        ));
        let created = coalesce_buffered_changes(normalize_notify_event_for_buffer(
            notify::Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::To)))
                .add_path(PathBuf::from("C:/library/moved-in.mkv")),
        ));

        assert_eq!(removed[0].kind, FolderChangeKind::Remove);
        assert_eq!(removed[0].paths, vec!["C:/library/moved-out.mkv"]);
        assert_eq!(created[0].kind, FolderChangeKind::Create);
        assert_eq!(created[0].paths, vec!["C:/library/moved-in.mkv"]);
    }

    #[test]
    fn emits_removals_but_ignores_generated_thumbnails_and_unknown_files() {
        let removed = normalize_notify_event(
            notify::Event::new(EventKind::Remove(RemoveKind::File))
                .add_path(PathBuf::from("C:/library/clip.m4v")),
        );
        let thumbnail = normalize_notify_event(
            notify::Event::new(EventKind::Create(CreateKind::File))
                .add_path(PathBuf::from("C:/library/thumbnail.png")),
        );
        let text = normalize_notify_event(
            notify::Event::new(EventKind::Create(CreateKind::File))
                .add_path(PathBuf::from("C:/library/readme.txt")),
        );

        assert_eq!(removed[0].kind, FolderChangeKind::Remove);
        assert!(thumbnail.is_empty());
        assert!(text.is_empty());
    }
}
