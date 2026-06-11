use crate::db::facets::{refresh_live_facet_resources_in_transaction, FacetResourceTouches};
use crate::db::resolve_db_path;
use crate::metadata::models::{ModelDiscoveryState, ThumbnailScanResult};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
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
    hash: String,
}

#[derive(Debug, Default, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePurgeResult {
    pub removed_models: usize,
    pub preserved_models: usize,
    pub removed_scanned_files: usize,
    pub refreshed_facets: usize,
    pub resources: FacetResourceTouches,
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
             ON CONFLICT(hash) DO UPDATE SET
                filename = CASE
                    WHEN models.filename IS NULL OR models.filename = '' THEN excluded.filename
                    ELSE models.filename
                END,
                lookup_source = excluded.lookup_source,
                scanned_at = excluded.scanned_at,
                resource_type = excluded.resource_type
             WHERE models.lookup_source != 'disk_scan'
                OR models.filename IS NULL
                OR models.filename = ''",
            params![&hash, stem, filename, "disk_scan", now, resource_type],
        )
        .map_err(|e| e.to_string())?;

    Ok(ModelRegistrationOutcome {
        cached,
        registered_models,
        filename,
        hash,
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

fn normalize_scan_path(value: &str) -> String {
    let normalized = value
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();

    if cfg!(windows) {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

fn is_same_or_child_path(path: &str, folder: &str) -> bool {
    let path = normalize_scan_path(path);
    let folder = normalize_scan_path(folder);
    if path.is_empty() || folder.is_empty() {
        return false;
    }

    path == folder
        || path
            .strip_prefix(&folder)
            .map(|rest| rest.starts_with('/'))
            .unwrap_or(false)
}

fn file_hash_path(hash: &str) -> Option<&str> {
    hash.strip_prefix("file:")
}

fn link_sidecar_thumbnail_for_model(
    conn: &Connection,
    model_path: &str,
    model_hash: &str,
    images: &HashSet<String>,
) -> Result<bool, String> {
    let model_path_buf = std::path::PathBuf::from(model_path);

    let parent = match model_path_buf.parent() {
        Some(p) => p,
        None => return Ok(false),
    };

    let stem = match model_path_buf.file_stem().and_then(|s| s.to_str()) {
        Some(s) => s,
        None => return Ok(false),
    };

    let filename = match model_path_buf.file_name().and_then(|s| s.to_str()) {
        Some(n) => n,
        None => return Ok(false),
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

    for cand_name in candidates {
        let candidate_path = parent.join(&cand_name).to_string_lossy().to_string();
        if images.contains(&candidate_path) {
            let rows = conn
                .execute(
                    "UPDATE models
                     SET sidecar_thumbnail_path = ?1
                     WHERE hash = ?2
                       AND (sidecar_thumbnail_path IS NULL OR sidecar_thumbnail_path = '')",
                    params![candidate_path, model_hash],
                )
                .map_err(|e| e.to_string())?;
            return Ok(rows > 0);
        }
    }

    Ok(false)
}

fn purge_resource_folder_assets_inner(
    conn: &mut Connection,
    folder_path: &str,
    remaining_paths: &[String],
) -> Result<ResourcePurgeResult, String> {
    purge_resource_folder_assets_with_refresh(
        conn,
        folder_path,
        remaining_paths,
        refresh_live_facet_resources_in_transaction,
    )
}

fn purge_resource_folder_assets_with_refresh<F>(
    conn: &mut Connection,
    folder_path: &str,
    remaining_paths: &[String],
    refresh_facets: F,
) -> Result<ResourcePurgeResult, String>
where
    F: FnOnce(&Connection, &FacetResourceTouches) -> Result<usize, String>,
{
    if normalize_scan_path(folder_path).is_empty() {
        return Err("Resource folder path is required".to_string());
    }

    let remaining_paths: Vec<&str> = remaining_paths
        .iter()
        .map(String::as_str)
        .filter(|path| !normalize_scan_path(path).is_empty())
        .collect();
    let is_covered_by_remaining_path = |path: &str| {
        remaining_paths
            .iter()
            .any(|folder| is_same_or_child_path(path, folder))
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut resources = FacetResourceTouches::default();
    let mut model_candidates = Vec::new();

    {
        let mut stmt = tx
            .prepare(
                "SELECT hash, name, resource_type, thumbnail_path, thumbnail_mode,
                        thumbnail_sensitivity_override
                 FROM models
                 WHERE lookup_source = 'disk_scan'
                   AND hash LIKE 'file:%'",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (hash, name, resource_type, thumbnail_path, thumbnail_mode, sensitivity_override) =
                row.map_err(|e| e.to_string())?;
            let Some(path) = file_hash_path(&hash) else {
                continue;
            };
            if !is_same_or_child_path(path, folder_path) || is_covered_by_remaining_path(path) {
                continue;
            }

            let path_buf = Path::new(path);
            let fallback_name = path_buf.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let resource_name = name
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(fallback_name);
            let resource_type = resource_type
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| resource_type_for_model_path(path));
            touch_resource(&mut resources, resource_type, resource_name);
            let has_thumbnail_override = thumbnail_path
                .as_deref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false);
            let uses_dynamic_thumbnail = thumbnail_mode.as_deref() == Some("dynamic");
            let preserved_source = if has_thumbnail_override || uses_dynamic_thumbnail {
                Some("manual_thumbnail")
            } else if sensitivity_override.is_some() {
                Some("manual_thumbnail_privacy")
            } else {
                None
            };
            model_candidates.push((hash, preserved_source));
        }
    }

    let mut scanned_file_paths = Vec::new();
    {
        let mut stmt = tx
            .prepare("SELECT DISTINCT path FROM scanned_files")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;

        for row in rows {
            let path = row.map_err(|e| e.to_string())?;
            if is_same_or_child_path(&path, folder_path) && !is_covered_by_remaining_path(&path) {
                scanned_file_paths.push(path);
            }
        }
    }

    let mut removed_models = 0;
    let mut preserved_models = 0;
    for (hash, preserved_source) in model_candidates {
        if let Some(lookup_source) = preserved_source {
            preserved_models += tx
                .execute(
                    "UPDATE models
                     SET lookup_source = ?2, sidecar_thumbnail_path = NULL
                     WHERE lookup_source = 'disk_scan' AND hash = ?1",
                    params![hash, lookup_source],
                )
                .map_err(|e| e.to_string())?;
        } else {
            removed_models += tx
                .execute(
                    "DELETE FROM models WHERE lookup_source = 'disk_scan' AND hash = ?1",
                    params![hash],
                )
                .map_err(|e| e.to_string())?;
        }
    }

    let mut removed_scanned_files = 0;
    for path in scanned_file_paths {
        removed_scanned_files += tx
            .execute("DELETE FROM scanned_files WHERE path = ?1", params![path])
            .map_err(|e| e.to_string())?;
    }
    let refreshed_facets = refresh_facets(&tx, &resources)?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok(ResourcePurgeResult {
        removed_models,
        preserved_models,
        removed_scanned_files,
        refreshed_facets,
        resources,
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn purge_resource_folder_assets(
    app: tauri::AppHandle,
    path: String,
    remaining_paths: Vec<String>,
) -> Result<ResourcePurgeResult, String> {
    let db_path = resolve_db_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;
        purge_resource_folder_assets_inner(&mut conn, &path, &remaining_paths)
    })
    .await
    .map_err(|e| e.to_string())?
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
    let mut registered_hashes: HashMap<String, String> = HashMap::new();

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
            registered_hashes.insert(model_path.to_string(), outcome.hash.clone());

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

        for (i, model_path) in models_found.iter().enumerate() {
            let model_path_buf = Path::new(model_path);
            let filename = match model_path_buf.file_name().and_then(|s| s.to_str()) {
                Some(n) => n.to_string(),
                None => model_path.to_string(),
            };

            if let Some(hash) = registered_hashes.get(model_path) {
                if link_sidecar_thumbnail_for_model(&conn, model_path, hash, &images_map)? {
                    updated_count += 1;
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
                resource_type TEXT,
                sidecar_thumbnail_path TEXT,
                thumbnail_path TEXT,
                thumbnail_mode TEXT,
                thumbnail_sensitivity_override INTEGER
            )",
            [],
        )
        .unwrap();
        conn.execute("CREATE TABLE images (metadata_json TEXT)", [])
            .unwrap();
        conn
    }

    fn insert_test_model(
        conn: &Connection,
        hash: &str,
        name: &str,
        lookup_source: &str,
        resource_type: &str,
    ) {
        conn.execute(
            "INSERT INTO models (hash, name, filename, lookup_source, scanned_at, resource_type)
             VALUES (?1, ?2, ?3, ?4, 100, ?5)",
            params![
                hash,
                name,
                format!("{name}.safetensors"),
                lookup_source,
                resource_type
            ],
        )
        .unwrap();
    }

    fn insert_test_scanned_file(conn: &Connection, path: &str, hash: &str) {
        conn.execute(
            "INSERT INTO scanned_files (path, size, modified, hash) VALUES (?1, 10, 20, ?2)",
            params![path, hash],
        )
        .unwrap();
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
    fn purge_resource_folder_assets_removes_only_disk_scan_rows_inside_folder() {
        let mut conn = registration_test_conn();
        let inside_path = "C:/AI/models/loras/Foo.safetensors";
        let sibling_path = "C:/AI/models/loras-old/Bar.safetensors";
        let manual_path = "C:/AI/models/loras/Manual.safetensors";

        insert_test_model(
            &conn,
            &format!("file:{inside_path}"),
            "Foo",
            "disk_scan",
            "loras",
        );
        insert_test_model(
            &conn,
            &format!("file:{sibling_path}"),
            "Bar",
            "disk_scan",
            "loras",
        );
        insert_test_model(
            &conn,
            &format!("file:{manual_path}"),
            "Manual",
            "manual_thumbnail",
            "loras",
        );
        insert_test_scanned_file(&conn, inside_path, &format!("file:{inside_path}"));
        insert_test_scanned_file(&conn, sibling_path, &format!("file:{sibling_path}"));

        let result = purge_resource_folder_assets_with_refresh(
            &mut conn,
            "C:/AI/models/loras",
            &[],
            |_, _| Ok(1),
        )
        .unwrap();

        assert_eq!(result.removed_models, 1);
        assert_eq!(result.preserved_models, 0);
        assert_eq!(result.removed_scanned_files, 1);
        assert_eq!(result.refreshed_facets, 1);
        assert_eq!(result.resources.loras, vec!["Foo"]);

        let remaining_models: i64 = conn
            .query_row("SELECT COUNT(*) FROM models", [], |row| row.get(0))
            .unwrap();
        let remaining_scanned_files: i64 = conn
            .query_row("SELECT COUNT(*) FROM scanned_files", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining_models, 2);
        assert_eq!(remaining_scanned_files, 1);

        let manual_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM models WHERE name = 'Manual'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(manual_exists, 1);
    }

    #[test]
    fn purge_resource_folder_assets_returns_touched_resources_by_type() {
        let mut conn = registration_test_conn();
        let rows = [
            (
                "C:/AI/models/checkpoints/Pony.safetensors",
                "Pony",
                "checkpoint",
            ),
            (
                "C:/AI/models/controlnet/Canny.safetensors",
                "Canny",
                "control_nets",
            ),
            ("C:/AI/models/ipadapter/FaceID.bin", "FaceID", "ip_adapters"),
        ];

        for (path, name, resource_type) in rows {
            insert_test_model(
                &conn,
                &format!("file:{path}"),
                name,
                "disk_scan",
                resource_type,
            );
        }

        let result =
            purge_resource_folder_assets_with_refresh(&mut conn, "C:/AI/models", &[], |_, _| Ok(3))
                .unwrap();

        assert_eq!(result.removed_models, 3);
        assert_eq!(result.refreshed_facets, 3);
        assert_eq!(result.resources.checkpoints, vec!["Pony"]);
        assert_eq!(result.resources.control_nets, vec!["Canny"]);
        assert_eq!(result.resources.ip_adapters, vec!["FaceID"]);
    }

    #[test]
    fn purge_preserves_assets_covered_by_remaining_child_folder() {
        let mut conn = registration_test_conn();
        let lora_path = "C:/AI/models/loras/Foo.safetensors";
        let checkpoint_path = "C:/AI/models/checkpoints/Bar.safetensors";

        insert_test_model(
            &conn,
            &format!("file:{lora_path}"),
            "Foo",
            "disk_scan",
            "loras",
        );
        insert_test_model(
            &conn,
            &format!("file:{checkpoint_path}"),
            "Bar",
            "disk_scan",
            "checkpoint",
        );
        insert_test_scanned_file(&conn, lora_path, &format!("file:{lora_path}"));
        insert_test_scanned_file(&conn, checkpoint_path, &format!("file:{checkpoint_path}"));

        let result = purge_resource_folder_assets_with_refresh(
            &mut conn,
            "C:/AI/models",
            &["C:/AI/models/loras".to_string()],
            |_, _| Ok(1),
        )
        .unwrap();

        assert_eq!(result.removed_models, 1);
        assert_eq!(result.resources.checkpoints, vec!["Bar"]);
        assert!(result.resources.loras.is_empty());
        let lora_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM models WHERE hash = ?1",
                [format!("file:{lora_path}")],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(lora_exists, 1);
    }

    #[test]
    fn purge_preserves_assets_covered_by_remaining_parent_folder() {
        let mut conn = registration_test_conn();
        let lora_path = "C:/AI/models/loras/Foo.safetensors";
        insert_test_model(
            &conn,
            &format!("file:{lora_path}"),
            "Foo",
            "disk_scan",
            "loras",
        );
        insert_test_scanned_file(&conn, lora_path, &format!("file:{lora_path}"));

        let result = purge_resource_folder_assets_with_refresh(
            &mut conn,
            "C:/AI/models/loras",
            &["C:/AI/models".to_string()],
            |_, _| Ok(0),
        )
        .unwrap();

        assert_eq!(result.removed_models, 0);
        assert_eq!(result.removed_scanned_files, 0);
        assert!(result.resources.loras.is_empty());
    }

    #[test]
    fn purge_preserves_manual_thumbnail_state_as_non_local_metadata() {
        let mut conn = registration_test_conn();
        let path = "C:/AI/models/loras/Customized.safetensors";
        let hash = format!("file:{path}");
        insert_test_model(&conn, &hash, "Customized", "disk_scan", "loras");
        insert_test_scanned_file(&conn, path, &hash);
        conn.execute(
            "UPDATE models
             SET thumbnail_path = 'C:/thumbs/custom.webp',
                 thumbnail_sensitivity_override = 1,
                 sidecar_thumbnail_path = 'C:/AI/models/loras/Customized.preview.png'
             WHERE hash = ?1",
            [&hash],
        )
        .unwrap();

        let result = purge_resource_folder_assets_with_refresh(
            &mut conn,
            "C:/AI/models/loras",
            &[],
            |_, _| Ok(1),
        )
        .unwrap();

        assert_eq!(result.removed_models, 0);
        assert_eq!(result.preserved_models, 1);
        assert_eq!(result.removed_scanned_files, 1);
        let preserved: (String, Option<String>, Option<String>, Option<i64>) = conn
            .query_row(
                "SELECT lookup_source, thumbnail_path, sidecar_thumbnail_path,
                        thumbnail_sensitivity_override
                 FROM models WHERE hash = ?1",
                [&hash],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(preserved.0, "manual_thumbnail");
        assert_eq!(preserved.1.as_deref(), Some("C:/thumbs/custom.webp"));
        assert_eq!(preserved.2, None);
        assert_eq!(preserved.3, Some(1));
    }

    #[test]
    fn purge_preserves_dynamic_and_privacy_only_customizations() {
        let mut conn = registration_test_conn();
        let dynamic_path = "C:/AI/models/loras/Dynamic.safetensors";
        let privacy_path = "C:/AI/models/loras/Private.safetensors";
        let dynamic_hash = format!("file:{dynamic_path}");
        let privacy_hash = format!("file:{privacy_path}");
        insert_test_model(&conn, &dynamic_hash, "Dynamic", "disk_scan", "loras");
        insert_test_model(&conn, &privacy_hash, "Private", "disk_scan", "loras");
        insert_test_scanned_file(&conn, dynamic_path, &dynamic_hash);
        insert_test_scanned_file(&conn, privacy_path, &privacy_hash);
        conn.execute(
            "UPDATE models SET thumbnail_mode = 'dynamic' WHERE hash = ?1",
            [&dynamic_hash],
        )
        .unwrap();
        conn.execute(
            "UPDATE models SET thumbnail_sensitivity_override = 0 WHERE hash = ?1",
            [&privacy_hash],
        )
        .unwrap();

        let result = purge_resource_folder_assets_with_refresh(
            &mut conn,
            "C:/AI/models/loras",
            &[],
            |_, _| Ok(1),
        )
        .unwrap();

        assert_eq!(result.removed_models, 0);
        assert_eq!(result.preserved_models, 2);
        let dynamic_source: String = conn
            .query_row(
                "SELECT lookup_source FROM models WHERE hash = ?1",
                [&dynamic_hash],
                |row| row.get(0),
            )
            .unwrap();
        let privacy_source: String = conn
            .query_row(
                "SELECT lookup_source FROM models WHERE hash = ?1",
                [&privacy_hash],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(dynamic_source, "manual_thumbnail");
        assert_eq!(privacy_source, "manual_thumbnail_privacy");
    }

    #[test]
    fn rediscovery_restores_preserved_model_as_local_without_losing_customization() {
        let root = temp_resource_dir("rediscover_customized");
        let lora_dir = root.join("loras");
        fs::create_dir_all(&lora_dir).unwrap();
        let model_path = lora_dir.join("Customized.safetensors");
        fs::write(&model_path, b"model").unwrap();
        let model_path = model_path.to_string_lossy().to_string();
        let hash = format!("file:{model_path}");
        let conn = registration_test_conn();
        insert_test_model(&conn, &hash, "Customized", "manual_thumbnail", "loras");
        conn.execute(
            "UPDATE models SET thumbnail_path = 'C:/thumbs/custom.webp' WHERE hash = ?1",
            [&hash],
        )
        .unwrap();
        let mut resources = FacetResourceTouches::default();

        register_discovered_model_file(&conn, &model_path, 200, &mut resources).unwrap();

        let restored: (String, Option<String>) = conn
            .query_row(
                "SELECT lookup_source, thumbnail_path FROM models WHERE hash = ?1",
                [&hash],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(restored.0, "disk_scan");
        assert_eq!(restored.1.as_deref(), Some("C:/thumbs/custom.webp"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn purge_rolls_back_when_facet_refresh_fails() {
        let mut conn = registration_test_conn();
        let path = "C:/AI/models/loras/Foo.safetensors";
        let hash = format!("file:{path}");
        insert_test_model(&conn, &hash, "Foo", "disk_scan", "loras");
        insert_test_scanned_file(&conn, path, &hash);

        let result = purge_resource_folder_assets_with_refresh(
            &mut conn,
            "C:/AI/models/loras",
            &[],
            |_, _| Err("forced refresh failure".to_string()),
        );

        assert_eq!(result.unwrap_err(), "forced refresh failure");
        let model_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM models", [], |row| row.get(0))
            .unwrap();
        let scanned_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM scanned_files", [], |row| row.get(0))
            .unwrap();
        assert_eq!(model_count, 1);
        assert_eq!(scanned_count, 1);
    }

    #[test]
    fn sidecar_linking_updates_only_exact_discovered_hash() {
        let conn = registration_test_conn();
        let first_path = "C:/AI/models/loras/Duplicate.safetensors";
        let second_path = "D:/Archive/loras/Duplicate.safetensors";
        let first_hash = format!("file:{first_path}");
        let second_hash = format!("file:{second_path}");
        let first_thumb = Path::new(first_path)
            .parent()
            .unwrap()
            .join("Duplicate.preview.png")
            .to_string_lossy()
            .to_string();
        let mut images = HashSet::new();
        images.insert(first_thumb.clone());

        insert_test_model(&conn, &first_hash, "Duplicate", "disk_scan", "loras");
        insert_test_model(&conn, &second_hash, "Duplicate", "disk_scan", "loras");

        let linked =
            link_sidecar_thumbnail_for_model(&conn, first_path, &first_hash, &images).unwrap();

        assert!(linked);
        let first_sidecar: Option<String> = conn
            .query_row(
                "SELECT sidecar_thumbnail_path FROM models WHERE hash = ?1",
                params![first_hash],
                |row| row.get(0),
            )
            .unwrap();
        let second_sidecar: Option<String> = conn
            .query_row(
                "SELECT sidecar_thumbnail_path FROM models WHERE hash = ?1",
                params![second_hash],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(first_sidecar.as_deref(), Some(first_thumb.as_str()));
        assert_eq!(second_sidecar, None);
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
