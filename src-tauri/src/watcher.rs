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

    let last_emit_local = std::sync::Arc::new(Mutex::new(
        Instant::now().checked_sub(Duration::from_secs(10)).unwrap(),
    ));

    let event_handler = move |res: notify::Result<notify::Event>| {
        match res {
            Ok(event) => {
                println!("[Rust Watcher] Raw Event: {:?}", event);
                let is_relevant = match event.kind {
                    notify::EventKind::Create(_)
                    | notify::EventKind::Modify(_)
                    | notify::EventKind::Access(notify::event::AccessKind::Close(_)) => true,
                    notify::EventKind::Any => true, // Catch-all for some OSs
                    // Handle Rename/Move - essential for windows drag/drop
                    notify::EventKind::Modify(notify::event::ModifyKind::Name(_)) => true,
                    _ => false,
                };

                if is_relevant {
                    let has_image = event.paths.iter().any(|p| {
                        let is_image = p
                            .extension()
                            .map(|e| {
                                let s = e.to_string_lossy().to_lowercase();
                                ["png", "jpg", "jpeg", "webp"].contains(&s.as_str())
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

                    if has_image {
                        let mut last = last_emit_local.lock().unwrap();
                        if last.elapsed() > Duration::from_millis(2000) {
                            println!("[Rust Watcher] Detected change in watched folders, emitting event...");
                            let _ = app_handle.emit("folder-change-event", ());
                            *last = Instant::now();
                        }
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
