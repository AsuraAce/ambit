use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;

const WATCHER_THROTTLE_MS: u64 = 1_000;
const WATCHER_TIMEOUT_MS: u64 = 250;

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
            println!("[Rust Watcher] Stopped watcher");
        }
        return Ok(());
    }

    let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;

    if watcher_guard.is_some() {
        *watcher_guard = None;
        println!("[Rust Watcher] Restarting watcher with new paths...");
    }

    let app_handle = app.clone();

    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<String>>(1000);

    tauri::async_runtime::spawn(async move {
        let mut buffer = std::collections::HashSet::new();
        let mut first_event_time: Option<tokio::time::Instant> = None;
        let throttle_duration = tokio::time::Duration::from_millis(WATCHER_THROTTLE_MS);

        loop {
            match tokio::time::timeout(
                tokio::time::Duration::from_millis(WATCHER_TIMEOUT_MS),
                rx.recv(),
            )
            .await
            {
                Ok(Some(paths)) => {
                    buffer.extend(paths);
                    if first_event_time.is_none() {
                        first_event_time = Some(tokio::time::Instant::now());
                    } else if first_event_time
                        .map(|started_at| started_at.elapsed() >= throttle_duration)
                        .unwrap_or(false)
                    {
                        let batch_age_ms = first_event_time
                            .map(|started_at| started_at.elapsed().as_millis())
                            .unwrap_or(0);
                        let to_emit: Vec<String> = buffer.drain().collect();
                        println!(
                            "[LiveWatchPerf] watcher batch emitted | reason=throttle | paths={} | age_ms={} | types={}",
                            to_emit.len(),
                            batch_age_ms,
                            summarize_path_types(&to_emit)
                        );
                        let _ = app_handle.emit("folder-change-event", to_emit);
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
                        let to_emit: Vec<String> = buffer.drain().collect();
                        println!(
                            "[LiveWatchPerf] watcher batch emitted | reason=timeout | paths={} | age_ms={} | types={}",
                            to_emit.len(),
                            batch_age_ms,
                            summarize_path_types(&to_emit)
                        );
                        let _ = app_handle.emit("folder-change-event", to_emit);
                        first_event_time = None;
                    }
                }
            }
        }
    });

    let event_handler = move |res: notify::Result<notify::Event>| {
        match res {
            Ok(event) => {
                let is_relevant = match event.kind {
                    notify::EventKind::Create(_)
                    | notify::EventKind::Modify(_)
                    | notify::EventKind::Access(notify::event::AccessKind::Close(_)) => true,
                    notify::EventKind::Any => true, // Catch-all for some OSs
                    _ => false,
                };

                if is_relevant {
                    let has_image = event.paths.iter().any(|p| {
                        let is_image = p
                            .extension()
                            .map(|e| {
                                let s = e.to_string_lossy().to_lowercase();
                                ["png", "jpg", "jpeg", "webp", "db", "db-wal"].contains(&s.as_str())
                            })
                            .unwrap_or(false);

                        if !is_image {
                            return false;
                        }

                        // Filter out A1111 thumbnails
                        let is_thumbnail = p
                            .file_name()
                            .and_then(|n| n.to_str())
                            .map(|n| n.to_lowercase().ends_with("thumbnail.png"))
                            .unwrap_or(false);

                        !is_thumbnail
                    });

                    if !has_image {
                        return;
                    }

                    let raw_path_count = event.paths.len();
                    let event_kind = format!("{:?}", event.kind);
                    let valid_paths: Vec<String> = event
                        .paths
                        .into_iter()
                        .filter_map(|p| {
                            let s = p.to_string_lossy().to_string();
                            let s_lower = s.to_lowercase();
                            let is_target_file = ["png", "jpg", "jpeg", "webp", "db", "db-wal"]
                                .iter()
                                .any(|ext| s_lower.ends_with(ext));
                            let is_thumbnail = s_lower.ends_with("thumbnail.png");

                            if is_target_file && !is_thumbnail {
                                Some(s)
                            } else {
                                None
                            }
                        })
                        .collect();

                    if !valid_paths.is_empty() {
                        println!(
                            "[LiveWatchPerf] watcher event received | kind={} | raw_paths={} | matched_paths={} | types={}",
                            event_kind,
                            raw_path_count,
                            valid_paths.len(),
                            summarize_path_types(&valid_paths)
                        );
                        let _ = tx.blocking_send(valid_paths);
                    }
                }
            }
            Err(e) => println!("watch error: {:?}", e),
        }
    };

    let mut watcher =
        RecommendedWatcher::new(event_handler, Config::default()).map_err(|e| e.to_string())?;

    let mut errors = Vec::new();
    for path_str in &paths {
        let path_buf = PathBuf::from(path_str);
        if path_buf.exists() {
            if let Err(e) = watcher.watch(&path_buf, RecursiveMode::Recursive) {
                let err_msg = format!("Failed to watch path {}: {}", path_str, e);
                println!("[Rust Watcher] {}", err_msg);
                errors.push(err_msg);
            } else {
                println!("[Rust Watcher] Added path: {}", path_str);
            }
        } else {
            println!("[Rust Watcher] Skipping non-existent path: {}", path_str);
        }
    }

    *watcher_guard = Some(watcher);

    if !errors.is_empty() {
        return Err(errors.join("\n"));
    }

    Ok(())
}
