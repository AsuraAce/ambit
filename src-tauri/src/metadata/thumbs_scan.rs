use crate::db::facets::FacetResourceTouches;
use crate::db::resolve_db_path;
use crate::metadata::models::{ModelDiscoveryState, ThumbnailScanResult};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

const DISCOVERY_CANCELLED_MESSAGE: &str = "Discovery scan cancelled by user";
const SCAN_PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryProgressPayload {
    current: usize,
    total: usize,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    started_at: Option<u64>,
}

#[derive(Debug, Default, Clone, Copy)]
struct ResourceScanStats {
    folders_checked: usize,
    files_checked: usize,
}

impl ResourceScanStats {
    fn add(&mut self, other: ResourceScanStats) {
        self.folders_checked += other.folders_checked;
        self.files_checked += other.files_checked;
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn progress_payload(
    current: usize,
    total: usize,
    message: impl Into<String>,
    phase: &str,
    mode: &str,
    detail: Option<String>,
    started_at: u64,
) -> DiscoveryProgressPayload {
    DiscoveryProgressPayload {
        current,
        total,
        message: message.into(),
        phase: Some(phase.to_string()),
        mode: Some(mode.to_string()),
        detail,
        started_at: Some(started_at),
    }
}

fn emit_progress(app: &tauri::AppHandle, payload: DiscoveryProgressPayload) {
    let _ = app.emit("discovery_scan_progress", payload);
}

fn resource_count_detail(found: usize, updated: usize) -> String {
    format!("{found} model files found | {updated} thumbnails linked")
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct ModelRegistrationOutcome {
    cached: bool,
    registered_models: usize,
    filename: String,
}

fn file_size_and_modified(path: &Path) -> (i64, i64) {
    match std::fs::metadata(path) {
        Ok(metadata) => (
            metadata.len() as i64,
            metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
        ),
        Err(_) => (0, 0),
    }
}

fn register_discovered_model_file(
    conn: &Connection,
    model_path: &str,
    now: u64,
    touched_resources: &mut FacetResourceTouches,
) -> Result<ModelRegistrationOutcome, String> {
    let model_path_buf = Path::new(model_path);
    let filename = model_path_buf
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let stem = model_path_buf
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let resource_type = resource_type_for_model_path(model_path);

    touch_resource(touched_resources, resource_type, stem);

    let (file_size, file_modified) = file_size_and_modified(model_path_buf);
    let cached_hash: Option<String> = conn
        .query_row(
            "SELECT hash FROM scanned_files WHERE path = ?1 AND size = ?2 AND modified = ?3",
            params![model_path, file_size, file_modified],
            |row| row.get(0),
        )
        .ok();

    let (hash, cached) = if let Some(hash) = cached_hash {
        (hash, true)
    } else {
        let hash = format!("file:{}", model_path);
        conn.execute(
            "INSERT OR REPLACE INTO scanned_files (path, size, modified, hash)
             VALUES (?1, ?2, ?3, ?4)",
            params![model_path, file_size, file_modified, &hash],
        )
        .map_err(|e| e.to_string())?;
        (hash, false)
    };

    let registered_models = conn
        .execute(
            "INSERT INTO models (hash, name, filename, lookup_source, scanned_at, resource_type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(hash) DO UPDATE SET filename = excluded.filename, resource_type = excluded.resource_type WHERE filename IS NULL OR filename = ''",
            params![hash, stem, filename, "disk_scan", now, resource_type],
        )
        .map_err(|e| e.to_string())?;

    Ok(ModelRegistrationOutcome {
        cached,
        registered_models,
        filename,
    })
}

fn scan_count_detail(
    assets_found: usize,
    stats: ResourceScanStats,
    current_folder: Option<&Path>,
) -> String {
    let mut detail = format!(
        "{assets_found} model files found | {} files checked | {} folders checked",
        stats.files_checked, stats.folders_checked
    );

    if let Some(folder) = current_folder {
        detail.push_str(" | folder: ");
        detail.push_str(&compact_path(folder));
    }

    detail
}

fn compact_path(path: &Path) -> String {
    let parts: Vec<String> = path
        .components()
        .filter_map(|component| component.as_os_str().to_str().map(|s| s.to_string()))
        .filter(|part| !part.trim().is_empty())
        .collect();

    let compact = if parts.len() >= 2 {
        format!("{}/{}", parts[parts.len() - 2], parts[parts.len() - 1])
    } else {
        path.to_string_lossy().to_string()
    };

    truncate_middle(&compact, 56)
}

fn truncate_middle(value: &str, max_chars: usize) -> String {
    let char_count = value.chars().count();
    if char_count <= max_chars {
        return value.to_string();
    }

    let keep_each_side = max_chars.saturating_sub(3) / 2;
    let start: String = value.chars().take(keep_each_side).collect();
    let end: String = value
        .chars()
        .rev()
        .take(keep_each_side)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{start}...{end}")
}

fn resource_type_for_model_path(model_path: &str) -> &'static str {
    let path_lower = model_path.to_lowercase();
    if path_lower.contains("lora") {
        "loras"
    } else if path_lower.contains("embedding") || path_lower.contains("textual_inversion") {
        "embeddings"
    } else if path_lower.contains("hypernetwork") {
        "hypernetworks"
    } else if path_lower.contains("controlnet")
        || path_lower.contains("control_net")
        || path_lower.contains("control-nets")
        || path_lower.contains("controlnets")
    {
        "control_nets"
    } else if path_lower.contains("ipadapter")
        || path_lower.contains("ip-adapter")
        || path_lower.contains("ip_adapter")
        || path_lower.contains("ipadapters")
    {
        "ip_adapters"
    } else {
        "checkpoint"
    }
}

fn push_unique_resource_name(values: &mut Vec<String>, name: &str) {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return;
    }

    if !values
        .iter()
        .any(|existing| existing.eq_ignore_ascii_case(trimmed))
    {
        values.push(trimmed.to_string());
    }
}

fn touch_resource(resources: &mut FacetResourceTouches, resource_type: &str, name: &str) {
    match resource_type {
        "checkpoint" => push_unique_resource_name(&mut resources.checkpoints, name),
        "loras" => push_unique_resource_name(&mut resources.loras, name),
        "embeddings" => push_unique_resource_name(&mut resources.embeddings, name),
        "hypernetworks" => push_unique_resource_name(&mut resources.hypernetworks, name),
        "control_nets" => push_unique_resource_name(&mut resources.control_nets, name),
        "ip_adapters" => push_unique_resource_name(&mut resources.ip_adapters, name),
        _ => {}
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn scan_model_thumbnails(
    app: tauri::AppHandle,
    paths: Vec<String>,
    state: tauri::State<'_, ModelDiscoveryState>,
) -> Result<ThumbnailScanResult, String> {
    state.is_cancelled.store(false, Ordering::SeqCst);

    let started_at = now_millis();
    let mut models_found = Vec::new();
    let mut images_map = std::collections::HashSet::new();
    let mut scan_stats = ResourceScanStats::default();
    let mut touched_resources = FacetResourceTouches::default();

    let total_paths = paths.len();
    emit_progress(
        &app,
        progress_payload(
            0,
            0,
            "Scanning resource folders...",
            "Scanning folders",
            "indeterminate",
            Some(scan_count_detail(0, scan_stats, None)),
            started_at,
        ),
    );

    for (i, root_path) in paths.iter().enumerate() {
        if state.is_cancelled.load(Ordering::SeqCst) {
            return Err(DISCOVERY_CANCELLED_MESSAGE.to_string());
        }

        emit_progress(
            &app,
            progress_payload(
                0,
                0,
                "Scanning resource folders...",
                "Scanning folders",
                "indeterminate",
                Some(format!(
                    "folder {} of {} | {}",
                    i + 1,
                    total_paths,
                    scan_count_detail(models_found.len(), scan_stats, Some(Path::new(root_path)))
                )),
                started_at,
            ),
        );

        let path_buf = std::path::PathBuf::from(root_path);
        if path_buf.exists() && path_buf.is_dir() {
            let base_stats = scan_stats;
            let mut emit_scan =
                |stats: ResourceScanStats, assets_found: usize, current_folder: &Path| {
                    let mut cumulative = base_stats;
                    cumulative.add(stats);
                    emit_progress(
                        &app,
                        progress_payload(
                            assets_found,
                            0,
                            "Scanning resource folders...",
                            "Scanning folders",
                            "indeterminate",
                            Some(scan_count_detail(
                                assets_found,
                                cumulative,
                                Some(current_folder),
                            )),
                            started_at,
                        ),
                    );
                };

            let root_stats = scan_dir_for_resources(
                &path_buf,
                &mut models_found,
                &mut images_map,
                &state,
                &mut emit_scan,
            )?;
            scan_stats.add(root_stats);
        }
    }

    if models_found.is_empty() {
        emit_progress(
            &app,
            progress_payload(
                0,
                0,
                "Resource scan complete",
                "Complete",
                "complete",
                Some(resource_count_detail(0, 0)),
                started_at,
            ),
        );
        return Ok(ThumbnailScanResult {
            found: 0,
            updated: 0,
            cached_files: 0,
            new_or_changed_files: 0,
            registered_models: 0,
            resources: FacetResourceTouches::default(),
        });
    }

    emit_progress(
        &app,
        progress_payload(
            models_found.len(),
            0,
            "Preparing resource index...",
            "Preparing index",
            "indeterminate",
            Some(scan_count_detail(models_found.len(), scan_stats, None)),
            started_at,
        ),
    );

    let db_path = resolve_db_path(&app)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let mut updated_count = 0;
    let mut cached_files = 0;
    let mut new_or_changed_files = 0;
    let mut registered_models = 0;

    {
        emit_progress(
            &app,
            progress_payload(
                0,
                models_found.len(),
                "Registering discovered assets...",
                "Registering assets",
                "determinate",
                Some(scan_count_detail(models_found.len(), scan_stats, None)),
                started_at,
            ),
        );

        let mut last_emit = Instant::now();

        for (i, model_path) in models_found.iter().enumerate() {
            if state.is_cancelled.load(Ordering::SeqCst) {
                return Err(DISCOVERY_CANCELLED_MESSAGE.to_string());
            }

            let filename = Path::new(model_path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            if last_emit.elapsed().as_millis() > 200 {
                emit_progress(
                    &app,
                    progress_payload(
                        i + 1,
                        models_found.len(),
                        "Checking discovered asset...",
                        "Registering assets",
                        "determinate",
                        Some(filename.to_string()),
                        started_at,
                    ),
                );
                last_emit = Instant::now();
            }

            let outcome =
                register_discovered_model_file(&conn, model_path, now, &mut touched_resources)?;
            if outcome.cached {
                cached_files += 1;
            } else {
                new_or_changed_files += 1;
            }
            registered_models += outcome.registered_models;

            if last_emit.elapsed().as_millis() > 200 || i == models_found.len() - 1 {
                if state.is_cancelled.load(Ordering::SeqCst) {
                    return Err(DISCOVERY_CANCELLED_MESSAGE.to_string());
                }
                emit_progress(
                    &app,
                    progress_payload(
                        i + 1,
                        models_found.len(),
                        "Registering discovered assets...",
                        "Registering assets",
                        "determinate",
                        Some(outcome.filename),
                        started_at,
                    ),
                );
                last_emit = Instant::now();
            }
        }

        emit_progress(
            &app,
            progress_payload(
                0,
                0,
                "Preparing resource thumbnails...",
                "Linking thumbnails",
                "indeterminate",
                Some(resource_count_detail(models_found.len(), 0)),
                started_at,
            ),
        );

        let mut update_stmt = conn.prepare_cached(
            "UPDATE models SET sidecar_thumbnail_path = ?1 WHERE (filename = ?2 COLLATE NOCASE OR name = ?3 COLLATE NOCASE OR name = ?4 COLLATE NOCASE) AND (sidecar_thumbnail_path IS NULL OR sidecar_thumbnail_path = '')"
        ).map_err(|e| e.to_string())?;

        for (i, model_path) in models_found.iter().enumerate() {
            let model_path_buf = std::path::PathBuf::from(&model_path);

            let parent = match model_path_buf.parent() {
                Some(p) => p,
                None => continue,
            };

            let stem = match model_path_buf.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s,
                None => continue,
            };

            let filename = match model_path_buf.file_name().and_then(|s| s.to_str()) {
                Some(n) => n,
                None => continue,
            };

            let candidates = [
                format!("{}.preview.png", stem),
                format!("{}.preview.jpg", stem),
                format!("{}.preview.webp", stem),
                format!("{}.png", stem),
                format!("{}.jpg", stem),
                format!("{}.webp", stem),
                format!("{}.jpeg", stem),
                format!("{}.png", filename),
                format!("{}.jpg", filename),
                format!("{}.webp", filename),
            ];

            let mut best_thumb: Option<String> = None;

            for cand_name in candidates {
                let candidate_path = parent.join(&cand_name).to_string_lossy().to_string();
                if images_map.contains(&candidate_path) {
                    best_thumb = Some(candidate_path);
                    break;
                }
            }

            if let Some(thumb_path) = best_thumb {
                if let Ok(rows) = update_stmt.execute(params![thumb_path, filename, stem, filename])
                {
                    if rows > 0 {
                        updated_count += 1;
                    }
                }
            }

            if last_emit.elapsed().as_millis() > 200 || i == models_found.len() - 1 {
                if state.is_cancelled.load(Ordering::SeqCst) {
                    return Err(DISCOVERY_CANCELLED_MESSAGE.to_string());
                }
                emit_progress(
                    &app,
                    progress_payload(
                        i + 1,
                        models_found.len(),
                        "Matching resource thumbnails...",
                        "Matching thumbnails",
                        "determinate",
                        Some(filename.to_string()),
                        started_at,
                    ),
                );
                last_emit = Instant::now();
            }
        }
    }

    emit_progress(
        &app,
        progress_payload(
            models_found.len(),
            0,
            "Classifying discovered resources...",
            "Classifying resources",
            "indeterminate",
            Some(resource_count_detail(models_found.len(), updated_count)),
            started_at,
        ),
    );
    let _ = crate::metadata::models::classify_unlabeled_models(&conn);

    emit_progress(
        &app,
        progress_payload(
            models_found.len(),
            0,
            "Applying resource thumbnails...",
            "Applying thumbnails",
            "indeterminate",
            Some(resource_count_detail(models_found.len(), updated_count)),
            started_at,
        ),
    );
    let _ = refresh_facet_cache_from_models(&conn);

    Ok(ThumbnailScanResult {
        found: models_found.len(),
        updated: updated_count,
        cached_files,
        new_or_changed_files,
        registered_models,
        resources: touched_resources,
    })
}

fn scan_dir_for_resources(
    dir: &Path,
    models: &mut Vec<String>,
    images: &mut std::collections::HashSet<String>,
    state: &ModelDiscoveryState,
    emit_scan: &mut impl FnMut(ResourceScanStats, usize, &Path),
) -> Result<ResourceScanStats, String> {
    let mut stats = ResourceScanStats::default();
    let mut pending_dirs = vec![dir.to_path_buf()];
    let mut last_emit = Instant::now() - SCAN_PROGRESS_INTERVAL;

    while let Some(current_dir) = pending_dirs.pop() {
        if state.is_cancelled.load(Ordering::SeqCst) {
            return Err(DISCOVERY_CANCELLED_MESSAGE.to_string());
        }

        stats.folders_checked += 1;

        if last_emit.elapsed() >= SCAN_PROGRESS_INTERVAL {
            emit_scan(stats, models.len(), &current_dir);
            last_emit = Instant::now();
        }

        let entries = match std::fs::read_dir(&current_dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            if state.is_cancelled.load(Ordering::SeqCst) {
                return Err(DISCOVERY_CANCELLED_MESSAGE.to_string());
            }

            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };

            if file_type.is_dir() {
                pending_dirs.push(path);
            } else if file_type.is_file() {
                stats.files_checked += 1;
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                if is_model_resource_ext(&ext) {
                    models.push(path.to_string_lossy().to_string());
                } else if is_sidecar_image_ext(&ext) {
                    images.insert(path.to_string_lossy().to_string());
                }
            }

            if last_emit.elapsed() >= SCAN_PROGRESS_INTERVAL {
                emit_scan(stats, models.len(), &current_dir);
                last_emit = Instant::now();
            }
        }
    }

    emit_scan(stats, models.len(), dir);
    Ok(stats)
}

fn is_model_resource_ext(ext: &str) -> bool {
    matches!(ext, "safetensors" | "ckpt" | "pt" | "bin" | "pth")
}

fn is_sidecar_image_ext(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "webp")
}

pub fn refresh_facet_cache_from_models(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "UPDATE facet_cache
         SET thumbnail_path = (SELECT sidecar_thumbnail_path FROM models WHERE models.hash = facet_cache.resource_hash),
             has_sidecar = 1,
             is_manual = 1,
             thumbnail_image_id = NULL,
             thumbnail_sensitivity_override = (SELECT thumbnail_sensitivity_override FROM models WHERE models.hash = facet_cache.resource_hash),
             thumbnail_is_sensitive = CASE
                WHEN (SELECT thumbnail_sensitivity_override FROM models WHERE models.hash = facet_cache.resource_hash) = 0 THEN 0
                ELSE 1
             END
         WHERE resource_hash IN (SELECT hash FROM models WHERE sidecar_thumbnail_path IS NOT NULL AND sidecar_thumbnail_path != '')
         AND (is_user_override IS NULL OR is_user_override = 0)",
        params![],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE facet_cache
         SET thumbnail_path = (SELECT m.sidecar_thumbnail_path
                               FROM models m
                               WHERE m.name = facet_cache.resource_name
                               AND m.sidecar_thumbnail_path IS NOT NULL
                               AND m.sidecar_thumbnail_path != ''
                               LIMIT 1),
             has_sidecar = 1,
             is_manual = 1,
             thumbnail_image_id = NULL,
             thumbnail_sensitivity_override = (SELECT m.thumbnail_sensitivity_override
                               FROM models m
                               WHERE m.name = facet_cache.resource_name
                               AND m.sidecar_thumbnail_path IS NOT NULL
                               AND m.sidecar_thumbnail_path != ''
                               LIMIT 1),
             thumbnail_is_sensitive = CASE
                WHEN (SELECT m.thumbnail_sensitivity_override
                      FROM models m
                      WHERE m.name = facet_cache.resource_name
                      AND m.sidecar_thumbnail_path IS NOT NULL
                      AND m.sidecar_thumbnail_path != ''
                      LIMIT 1) = 0 THEN 0
                ELSE 1
             END
         WHERE resource_name IN (SELECT name FROM models WHERE sidecar_thumbnail_path IS NOT NULL AND sidecar_thumbnail_path != '')
         AND (thumbnail_path IS NULL OR thumbnail_path = '')
         AND (is_user_override IS NULL OR is_user_override = 0)",
        params![],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::fs;

    fn temp_resource_dir(test_name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ambit_{test_name}_{}", now_millis()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn registration_test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE scanned_files (
                path TEXT PRIMARY KEY,
                size INTEGER,
                modified INTEGER,
                hash TEXT
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE models (
                hash TEXT PRIMARY KEY,
                name TEXT,
                filename TEXT,
                lookup_source TEXT,
                scanned_at INTEGER,
                resource_type TEXT
            )",
            [],
        )
        .unwrap();
        conn.execute("CREATE TABLE images (metadata_json TEXT)", [])
            .unwrap();
        conn
    }

    #[test]
    fn discovery_indeterminate_payloads_do_not_use_fake_totals() {
        let payload = progress_payload(
            42,
            0,
            "Scanning resource folders...",
            "Scanning folders",
            "indeterminate",
            Some(scan_count_detail(42, ResourceScanStats::default(), None)),
            1000,
        );

        assert_eq!(payload.total, 0);
        assert_eq!(payload.mode.as_deref(), Some("indeterminate"));
        assert_ne!(payload.total, 100);
    }

    #[test]
    fn scan_dir_for_resources_reports_live_counters() {
        let root = temp_resource_dir("scan_counters");
        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("ponyDiffusionV6XL.safetensors"), b"model").unwrap();
        fs::write(nested.join("ponyDiffusionV6XL.preview.png"), b"image").unwrap();
        fs::write(root.join("notes.txt"), b"notes").unwrap();

        let state = ModelDiscoveryState::default();
        let mut models = Vec::new();
        let mut images = HashSet::new();
        let mut emitted = Vec::new();

        let stats = scan_dir_for_resources(
            &root,
            &mut models,
            &mut images,
            &state,
            &mut |stats, assets_found, folder| {
                emitted.push((stats, assets_found, compact_path(folder)));
            },
        )
        .unwrap();

        assert_eq!(models.len(), 1);
        assert_eq!(images.len(), 1);
        assert!(stats.files_checked >= 3);
        assert!(stats.folders_checked >= 2);
        assert!(emitted
            .iter()
            .any(|(_, assets_found, _)| *assets_found == 1));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scan_dir_for_resources_stops_when_cancelled_during_traversal() {
        let root = temp_resource_dir("scan_cancelled");
        fs::write(root.join("model.safetensors"), b"model").unwrap();

        let state = ModelDiscoveryState::default();

        let mut models = Vec::new();
        let mut images = HashSet::new();
        let mut emitted_count = 0;
        let result = scan_dir_for_resources(
            &root,
            &mut models,
            &mut images,
            &state,
            &mut |_stats, _assets_found, _folder| {
                emitted_count += 1;
                state.is_cancelled.store(true, Ordering::SeqCst);
            },
        );

        assert_eq!(result.unwrap_err(), DISCOVERY_CANCELLED_MESSAGE);
        assert!(emitted_count > 0);
        assert!(models.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resource_touches_are_grouped_by_comfyui_model_folders() {
        let mut resources = FacetResourceTouches::default();
        let paths = [
            "C:/ComfyUI/models/checkpoints/Pony Diffusion V6 XL.safetensors",
            "C:/ComfyUI/models/loras/CinematicDetail.safetensors",
            "C:/ComfyUI/models/embeddings/EasyNegative.pt",
            "C:/ComfyUI/models/hypernetworks/InkStyle.pt",
            "C:/ComfyUI/models/controlnet/OpenPose.safetensors",
            "C:/ComfyUI/models/ipadapter/FaceID.bin",
            "C:/ComfyUI/models/loras/cinematicdetail.safetensors",
        ];

        for path in paths {
            let stem = Path::new(path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap();
            touch_resource(&mut resources, resource_type_for_model_path(path), stem);
        }

        assert_eq!(resources.checkpoints, vec!["Pony Diffusion V6 XL"]);
        assert_eq!(resources.loras, vec!["CinematicDetail"]);
        assert_eq!(resources.embeddings, vec!["EasyNegative"]);
        assert_eq!(resources.hypernetworks, vec!["InkStyle"]);
        assert_eq!(resources.control_nets, vec!["OpenPose"]);
        assert_eq!(resources.ip_adapters, vec!["FaceID"]);
    }

    #[test]
    fn register_discovered_model_reports_new_then_cached_files() {
        let root = temp_resource_dir("registration_accounting");
        let lora_dir = root.join("loras");
        fs::create_dir_all(&lora_dir).unwrap();
        let model_path = lora_dir.join("CinematicDetail.safetensors");
        fs::write(&model_path, b"model").unwrap();
        let model_path = model_path.to_string_lossy().to_string();
        let conn = registration_test_conn();
        let mut resources = FacetResourceTouches::default();

        let first =
            register_discovered_model_file(&conn, &model_path, 100, &mut resources).unwrap();
        let second =
            register_discovered_model_file(&conn, &model_path, 101, &mut resources).unwrap();

        assert!(!first.cached);
        assert_eq!(first.registered_models, 1);
        assert!(second.cached);
        assert_eq!(second.registered_models, 0);
        assert_eq!(resources.loras, vec!["CinematicDetail"]);

        let scan_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM scanned_files", [], |row| row.get(0))
            .unwrap();
        let disk_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM models WHERE lookup_source = 'disk_scan'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(scan_rows, 1);
        assert_eq!(disk_rows, 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resource_registration_does_not_harvest_image_metadata_rows() {
        let root = temp_resource_dir("registration_disk_only");
        let lora_dir = root.join("loras");
        fs::create_dir_all(&lora_dir).unwrap();
        let model_path = lora_dir.join("DiskOnly.safetensors");
        fs::write(&model_path, b"model").unwrap();
        let model_path = model_path.to_string_lossy().to_string();
        let conn = registration_test_conn();
        conn.execute(
            "INSERT INTO images (metadata_json) VALUES (?1)",
            [r#"{"loras":["ImageOnlyLora"]}"#],
        )
        .unwrap();

        let mut resources = FacetResourceTouches::default();
        let result =
            register_discovered_model_file(&conn, &model_path, 100, &mut resources).unwrap();

        assert!(!result.cached);
        assert_eq!(resources.loras, vec!["DiskOnly"]);
        let harvested_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM models WHERE lookup_source LIKE 'harvest_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(harvested_rows, 0);

        let _ = fs::remove_dir_all(root);
    }
}
