use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;

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
        let throttle_duration = tokio::time::Duration::from_secs(2);

        loop {
            match tokio::time::timeout(tokio::time::Duration::from_millis(500), rx.recv()).await {
                Ok(Some(paths)) => {
                    buffer.extend(paths);
                    if first_event_time.is_none() {
                        first_event_time = Some(tokio::time::Instant::now());
                    } else if first_event_time.unwrap().elapsed() >= throttle_duration {
                        let to_emit: Vec<String> = buffer.drain().collect();
                        println!("[Rust Watcher] Emitting throttled batch of {} paths", to_emit.len());
                        let _ = app_handle.emit("folder-change-event", to_emit);
                        first_event_time = None;
                    }
                }
                Ok(None) => break, // Channel closed
                Err(_) => { // Timeout elapsed
                    if !buffer.is_empty() {
                        let to_emit: Vec<String> = buffer.drain().collect();
                        println!("[Rust Watcher] Emitting debounced batch of {} paths", to_emit.len());
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

                    let valid_paths: Vec<String> = event
                        .paths
                        .into_iter()
                        .filter_map(|p| {
                            let s = p.to_string_lossy().to_string();
                            let s_lower = s.to_lowercase();
                            let is_target_file = ["png", "jpg", "jpeg", "webp", "db", "db-wal"].iter().any(|ext| s_lower.ends_with(ext));
                            let is_thumbnail = s_lower.ends_with("thumbnail.png");
                            
                            if is_target_file && !is_thumbnail {
                                Some(s)
                            } else {
                                None
                            }
                        })
                        .collect();

                    if !valid_paths.is_empty() {
                        let _ = tx.blocking_send(valid_paths);
                    }
                }
            }
            Err(e) => println!("watch error: {:?}", e),
        }
    };

    let mut watcher =
        RecommendedWatcher::new(event_handler, Config::default()).map_err(|e| e.to_string())?;

    for path_str in &paths {
        let path_buf = PathBuf::from(path_str);
        if path_buf.exists() {
            if let Err(e) = watcher.watch(&path_buf, RecursiveMode::Recursive) {
                println!("[Rust Watcher] Failed to watch path {}: {}", path_str, e);
            } else {
                println!("[Rust Watcher] Added path: {}", path_str);
            }
        } else {
            println!("[Rust Watcher] Skipping non-existent path: {}", path_str);
        }
    }

    *watcher_guard = Some(watcher);

    Ok(())
}
