use crate::db::commands::run_blocking;
use base64::Engine;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{Manager, Wry};
use tauri_plugin_fs::FsExt;

use crate::db::reparse::{ReparseJobResult, ReparseState};
use crate::metadata::video::{
    extract_video_metadata, reparse_video_metadata, MetadataEvidenceSource,
    VideoGenerationMetadata, VideoGenerationMode, VideoMetadataDiagnostic,
};
use crate::metadata::VIDEO_PARSER_VERSION;

#[cfg(windows)]
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

const VIDEO_EXTENSIONS: [&str; 5] = ["mp4", "webm", "mov", "m4v", "mkv"];
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const PROBE_POLL_INTERVAL: Duration = Duration::from_millis(50);
const PROBE_REAP_TIMEOUT: Duration = Duration::from_secs(2);
const FULL_STDOUT_LIMIT: usize = 2 * 1024 * 1024;
const MINIMAL_STDOUT_LIMIT: usize = 256 * 1024;
const STDERR_LIMIT: usize = 32 * 1024;
const POSTER_LIMIT: usize = 2 * 1024 * 1024;
const POSTER_SOURCE: &str = "ambit-video-v1";
const UPSERT_VIDEO_ASSET_SQL: &str = r#"
    INSERT INTO images (
        id, path, width, height, file_size, timestamp, metadata_json,
        original_metadata_json, original_parsed_json, parser_version,
        model_name, tool, resolved_model_name, steps, seed, cfg, sampler,
        generation_type, positive_prompt, negative_prompt,
        is_deleted, is_missing, is_corrupt, media_type, media_container,
        media_mime_type, duration_ms, video_codec, video_profile,
        audio_present, audio_codec, frame_rate_num, frame_rate_den,
        rotation_degrees, probe_status, playback_status
    ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7,
        ?8, ?9, ?10,
        ?11, ?12, ?11, ?13, ?14, ?15, ?16,
        ?17, ?18, ?19,
        0, 0, 0, 'video', ?20, ?21, ?22, ?23, ?24,
        ?25, ?26, ?27, ?28, ?29, 'ready', 'unknown'
    )
    ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        width = excluded.width,
        height = excluded.height,
        playback_status = CASE
            WHEN images.timestamp IS NOT excluded.timestamp
              OR images.file_size IS NOT excluded.file_size THEN 'unknown'
            ELSE images.playback_status
        END,
        thumbnail_path = CASE
            WHEN images.timestamp IS NOT excluded.timestamp
              OR images.file_size IS NOT excluded.file_size THEN NULL
            ELSE images.thumbnail_path
        END,
        micro_thumbnail = CASE
            WHEN images.timestamp IS NOT excluded.timestamp
              OR images.file_size IS NOT excluded.file_size THEN NULL
            ELSE images.micro_thumbnail
        END,
        thumbnail_source = CASE
            WHEN images.timestamp IS NOT excluded.timestamp
              OR images.file_size IS NOT excluded.file_size THEN NULL
            ELSE images.thumbnail_source
        END,
        thumbnail_version = CASE
            WHEN images.timestamp IS NOT excluded.timestamp
              OR images.file_size IS NOT excluded.file_size THEN 0
            ELSE images.thumbnail_version
        END,
        thumbnail_failure_count = CASE
            WHEN images.timestamp IS NOT excluded.timestamp
              OR images.file_size IS NOT excluded.file_size THEN 0
            ELSE images.thumbnail_failure_count
        END,
        thumbnail_last_error = CASE
            WHEN images.timestamp IS NOT excluded.timestamp
              OR images.file_size IS NOT excluded.file_size THEN NULL
            ELSE images.thumbnail_last_error
        END,
        thumbnail_last_attempt_at = CASE
            WHEN images.timestamp IS NOT excluded.timestamp
              OR images.file_size IS NOT excluded.file_size THEN NULL
            ELSE images.thumbnail_last_attempt_at
        END,
        file_size = excluded.file_size,
        timestamp = excluded.timestamp,
        metadata_json = excluded.metadata_json,
        original_metadata_json = excluded.original_metadata_json,
        original_parsed_json = excluded.original_parsed_json,
        parser_version = excluded.parser_version,
        model_name = excluded.model_name,
        tool = excluded.tool,
        resolved_model_name = excluded.resolved_model_name,
        steps = excluded.steps,
        seed = excluded.seed,
        cfg = excluded.cfg,
        sampler = excluded.sampler,
        generation_type = excluded.generation_type,
        positive_prompt = excluded.positive_prompt,
        negative_prompt = excluded.negative_prompt,
        is_deleted = 0,
        is_missing = 0,
        is_corrupt = 0,
        media_type = 'video',
        media_container = excluded.media_container,
        media_mime_type = excluded.media_mime_type,
        duration_ms = excluded.duration_ms,
        video_codec = excluded.video_codec,
        video_profile = excluded.video_profile,
        audio_present = excluded.audio_present,
        audio_codec = excluded.audio_codec,
        frame_rate_num = excluded.frame_rate_num,
        frame_rate_den = excluded.frame_rate_den,
        rotation_degrees = excluded.rotation_degrees,
        probe_status = 'ready'
"#;

pub struct VideoImportState {
    gate: Arc<tokio::sync::Semaphore>,
    cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for VideoImportState {
    fn default() -> Self {
        Self::new()
    }
}

impl VideoImportState {
    pub fn new() -> Self {
        Self {
            gate: Arc::new(tokio::sync::Semaphore::new(1)),
            cancellations: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoAssetRecord {
    pub id: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
    pub timestamp: i64,
    pub media_container: Option<String>,
    pub media_mime_type: Option<String>,
    pub duration_ms: u64,
    pub video_codec: String,
    pub video_profile: Option<String>,
    pub audio_present: bool,
    pub audio_codec: Option<String>,
    pub frame_rate_num: Option<u32>,
    pub frame_rate_den: Option<u32>,
    pub rotation_degrees: u16,
    pub metadata: VideoGenerationMetadata,
    pub original_metadata_json: String,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoImportOutcome {
    pub status: String,
    pub asset: Option<VideoAssetRecord>,
    pub reason: Option<String>,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VideoPosterResult {
    pub asset_id: String,
    pub thumbnail_path: String,
    pub thumbnail_source: String,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportOriginalResult {
    pub asset_id: String,
    pub output_path: String,
    pub bytes_copied: u64,
}

#[derive(Debug, Clone, PartialEq)]
struct ProbeMetadata {
    width: u32,
    height: u32,
    container: Option<String>,
    mime_type: Option<String>,
    duration_ms: u64,
    video_codec: String,
    video_profile: Option<String>,
    audio_present: bool,
    audio_codec: Option<String>,
    frame_rate_num: Option<u32>,
    frame_rate_den: Option<u32>,
    rotation_degrees: u16,
    raw_mediainfo: Value,
    full_metadata_truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProbeFailureKind {
    Cancelled,
    Invalid,
    ToolUnavailable,
    OutputTooLarge,
}

#[derive(Debug)]
struct ProbeFailure {
    kind: ProbeFailureKind,
    message: String,
}

impl ProbeFailure {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            kind: ProbeFailureKind::Invalid,
            message: message.into(),
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn import_video_asset(
    app: tauri::AppHandle<Wry>,
    state: tauri::State<'_, VideoImportState>,
    path: String,
    operation_id: String,
) -> Result<VideoImportOutcome, String> {
    let operation_id = operation_id.trim().to_string();
    if operation_id.is_empty() {
        return Err("Operation ID cannot be empty".to_string());
    }

    let canonical = validate_scoped_video_file(&app, &path)?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut cancellations = state
            .cancellations
            .lock()
            .map_err(|_| "Video import cancellation state is unavailable".to_string())?;
        if cancellations.contains_key(&operation_id) {
            return Err("Operation ID is already active".to_string());
        }
        cancellations.insert(operation_id.clone(), cancel.clone());
    }

    let outcome = import_video_asset_inner(&app, &state.gate, &canonical, &cancel).await;
    if let Ok(mut cancellations) = state.cancellations.lock() {
        cancellations.remove(&operation_id);
    }
    outcome
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn refresh_video_metadata(
    app: tauri::AppHandle<Wry>,
    import_state: tauri::State<'_, VideoImportState>,
    reparse_state: tauri::State<'_, ReparseState>,
    filter_root: Option<String>,
    force_reparse: bool,
) -> Result<ReparseJobResult, String> {
    let normalized_root = filter_root.as_deref().map(|root| {
        root.replace('\\', "/")
            .trim_end_matches('/')
            .to_ascii_lowercase()
    });
    let paths = run_blocking(app.clone(), move |conn| {
        let sql = if force_reparse {
            "SELECT path, parser_version, original_metadata_json FROM images WHERE media_type = 'video' AND is_deleted = 0 AND is_missing = 0"
                .to_string()
        } else {
            format!(
                "SELECT path, parser_version, original_metadata_json FROM images WHERE media_type = 'video' AND is_deleted = 0 AND is_missing = 0 AND (parser_version IS NULL OR parser_version < {VIDEO_PARSER_VERSION})"
            )
        };
        let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<u32>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(rows)
    })
    .await?;
    let paths = paths.into_iter().filter(|(path, _, _)| {
        normalized_root.as_ref().is_none_or(|root| {
            let normalized = path.replace('\\', "/").to_ascii_lowercase();
            normalized == *root || normalized.starts_with(&format!("{root}/"))
        })
    });

    let mut result = ReparseJobResult {
        processed: 0,
        updated: 0,
        errors: 0,
        was_cancelled: false,
    };
    for (path, parser_version, original_evidence_json) in paths {
        if reparse_state.is_cancelled.load(Ordering::SeqCst) {
            result.was_cancelled = true;
            break;
        }
        result.processed += 1;
        if parser_version.is_some() {
            if let Some(metadata) = original_evidence_json
                .as_deref()
                .and_then(reparse_video_metadata)
            {
                let asset_id = path.clone();
                let update = run_blocking(app.clone(), move |conn| {
                    update_video_metadata_record(conn, &asset_id, &metadata)
                })
                .await;
                if update.is_ok() {
                    result.updated += 1;
                } else {
                    result.errors += 1;
                }
                continue;
            }
        }
        let canonical = match validate_scoped_video_file(&app, &path) {
            Ok(path) => path,
            Err(_) => {
                result.errors += 1;
                continue;
            }
        };
        let cancel = reparse_state.is_cancelled.clone();
        match import_video_asset_inner(&app, &import_state.gate, &canonical, &cancel).await {
            Ok(outcome) if outcome.asset.is_some() => result.updated += 1,
            Ok(outcome) if outcome.status == "cancelled" => {
                result.was_cancelled = true;
                break;
            }
            Ok(_) | Err(_) => result.errors += 1,
        }
    }
    Ok(result)
}

async fn import_video_asset_inner(
    app: &tauri::AppHandle<Wry>,
    gate: &Arc<tokio::sync::Semaphore>,
    canonical: &Path,
    cancel: &Arc<AtomicBool>,
) -> Result<VideoImportOutcome, String> {
    let permit = loop {
        if cancel.load(Ordering::Relaxed) {
            return Ok(cancelled_outcome());
        }
        match tokio::time::timeout(PROBE_POLL_INTERVAL, gate.clone().acquire_owned()).await {
            Ok(Ok(permit)) => break permit,
            Ok(Err(_)) => return Err("Video probe queue is unavailable".to_string()),
            Err(_) => continue,
        }
    };

    let normalized_path = normalize_path(canonical);
    let file_metadata = fs::metadata(canonical)
        .map_err(|error| format!("Failed to inspect video file: {error}"))?;
    let file_size = file_metadata.len();
    let timestamp = file_metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0);

    let probe = run_mediainfo(app, canonical, cancel).await;
    drop(permit);

    let probe = match probe {
        Ok(probe) => probe,
        Err(failure) if failure.kind == ProbeFailureKind::Cancelled => {
            return Ok(cancelled_outcome());
        }
        Err(failure) => {
            if matches!(
                failure.kind,
                ProbeFailureKind::Invalid | ProbeFailureKind::OutputTooLarge
            ) {
                mark_known_video_probe_invalid(app.clone(), normalized_path.clone()).await?;
            }
            return Ok(VideoImportOutcome {
                status: "rejected".to_string(),
                asset: None,
                reason: Some(match failure.kind {
                    ProbeFailureKind::ToolUnavailable => {
                        format!("toolUnavailable: {}", failure.message)
                    }
                    ProbeFailureKind::Invalid => format!("invalidVideo: {}", failure.message),
                    ProbeFailureKind::OutputTooLarge => {
                        format!("invalidVideo: {}", failure.message)
                    }
                    ProbeFailureKind::Cancelled => failure.message,
                }),
            });
        }
    };

    let mut evidence = extract_video_metadata(canonical, &probe.raw_mediainfo);
    if probe.full_metadata_truncated {
        evidence.metadata.diagnostics.push(VideoMetadataDiagnostic {
            code: "mediainfo_full_output_too_large".into(),
            message: "Full MediaInfo metadata exceeded 2 MiB; Ambit kept the video using a minimal technical probe".into(),
        });
    }
    let asset = VideoAssetRecord {
        id: normalized_path.clone(),
        path: normalized_path,
        width: probe.width,
        height: probe.height,
        file_size,
        timestamp,
        media_container: probe.container,
        media_mime_type: probe.mime_type,
        duration_ms: probe.duration_ms,
        video_codec: probe.video_codec,
        video_profile: probe.video_profile,
        audio_present: probe.audio_present,
        audio_codec: probe.audio_codec,
        frame_rate_num: probe.frame_rate_num,
        frame_rate_den: probe.frame_rate_den,
        rotation_degrees: probe.rotation_degrees,
        metadata: evidence.metadata,
        original_metadata_json: evidence.original_metadata_json,
    };

    persist_video_asset(app.clone(), asset).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn cancel_video_import(
    state: tauri::State<'_, VideoImportState>,
    operation_id: String,
) -> Result<bool, String> {
    let cancellations = state
        .cancellations
        .lock()
        .map_err(|_| "Video import cancellation state is unavailable".to_string())?;
    if let Some(cancel) = cancellations.get(operation_id.trim()) {
        cancel.store(true, Ordering::Relaxed);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn store_video_poster(
    app: tauri::AppHandle<Wry>,
    asset_id: String,
    webp_base64: String,
) -> Result<VideoPosterResult, String> {
    let bytes = decode_and_validate_poster(&webp_base64)?;
    let asset_id = asset_id.trim().to_string();
    if asset_id.is_empty() {
        return Err("Asset ID cannot be empty".to_string());
    }

    let exists = run_blocking(app.clone(), {
        let asset_id = asset_id.clone();
        move |conn| {
            conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM images WHERE id = ?1 AND media_type = 'video' AND is_deleted = 0)",
                [&asset_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value != 0)
            .map_err(|error| error.to_string())
        }
    })
    .await?;
    if !exists {
        return Err("Video asset is not present in the active library".to_string());
    }

    let thumbnail_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app local data directory: {error}"))?
        .join(".thumbnails");
    fs::create_dir_all(&thumbnail_dir)
        .map_err(|error| format!("Failed to create thumbnail directory: {error}"))?;

    let digest = hex::encode(Sha256::digest(&bytes));
    let thumbnail_path = crate::thumb::get_thumbnail_path(
        &format!("video-poster:v1:{asset_id}:{digest}"),
        &thumbnail_dir.to_string_lossy(),
    );
    if !thumbnail_path.exists() {
        let temporary_path = thumbnail_path.with_extension(format!("{}.tmp", std::process::id()));
        fs::write(&temporary_path, &bytes)
            .map_err(|error| format!("Failed to write video poster: {error}"))?;
        if let Err(error) = fs::rename(&temporary_path, &thumbnail_path) {
            let _ = fs::remove_file(&temporary_path);
            return Err(format!("Failed to publish video poster: {error}"));
        }
    }

    let normalized_thumbnail = normalize_path(&thumbnail_path);
    run_blocking(app, {
        let asset_id = asset_id.clone();
        let normalized_thumbnail = normalized_thumbnail.clone();
        move |conn| {
            conn.execute(
                "UPDATE images
                 SET thumbnail_path = ?1,
                     thumbnail_source = ?2,
                     thumbnail_version = 1,
                     thumbnail_failure_count = 0,
                     thumbnail_last_error = NULL
                 WHERE id = ?3 AND media_type = 'video' AND is_deleted = 0",
                params![normalized_thumbnail, POSTER_SOURCE, asset_id],
            )
            .map_err(|error| error.to_string())?;
            Ok(())
        }
    })
    .await?;

    Ok(VideoPosterResult {
        asset_id,
        thumbnail_path: normalized_thumbnail,
        thumbnail_source: POSTER_SOURCE.to_string(),
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn prepare_video_playback(
    app: tauri::AppHandle<Wry>,
    asset_id: String,
) -> Result<String, String> {
    let asset_id = asset_id.trim().to_string();
    if asset_id.is_empty() {
        return Err("Asset ID cannot be empty".to_string());
    }
    let path = run_blocking(app.clone(), move |conn| {
        load_video_playback_path(conn, &asset_id)?
            .ok_or_else(|| "Video asset is not present in the library or Removed".to_string())
    })
    .await?;
    let canonical = resolve_existing_regular_file(&path, "video")?;
    app.fs_scope()
        .allow_file(&canonical)
        .map_err(|error| format!("Failed to scope video file: {error}"))?;
    app.asset_protocol_scope()
        .allow_file(&canonical)
        .map_err(|error| format!("Failed to scope video asset URL: {error}"))?;
    Ok(normalize_path(&canonical))
}

fn load_video_playback_path(
    conn: &rusqlite::Connection,
    asset_id: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT path FROM images
         WHERE id = ?1 AND media_type = 'video' AND is_deleted = 0
         UNION ALL
         SELECT path FROM removed_images
         WHERE id = ?1 AND media_type = 'video'
         LIMIT 1",
        [asset_id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn export_asset_original(
    app: tauri::AppHandle<Wry>,
    asset_id: String,
    destination_directory: String,
) -> Result<ExportOriginalResult, String> {
    let asset_id = asset_id.trim().to_string();
    if asset_id.is_empty() {
        return Err("Asset ID cannot be empty".to_string());
    }

    let source_path = run_blocking(app.clone(), {
        let asset_id = asset_id.clone();
        move |conn| {
            conn.query_row(
                "SELECT path FROM images WHERE id = ?1
                 UNION ALL
                 SELECT path FROM removed_images WHERE id = ?1
                 LIMIT 1",
                [&asset_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Asset is not tracked by the library".to_string())
        }
    })
    .await?;

    let source = resolve_existing_regular_file(&source_path, "source asset")?;
    let destination = resolve_existing_directory(&destination_directory)?;
    if !app.fs_scope().is_allowed(&destination) {
        return Err(
            "Destination directory is outside the picker-approved filesystem scope".to_string(),
        );
    }

    let (output, bytes_copied) = copy_without_overwrite(&source, &destination)?;

    Ok(ExportOriginalResult {
        asset_id,
        output_path: normalize_path(&output),
        bytes_copied,
    })
}

fn cancelled_outcome() -> VideoImportOutcome {
    VideoImportOutcome {
        status: "cancelled".to_string(),
        asset: None,
        reason: None,
    }
}

fn validate_scoped_video_file(app: &tauri::AppHandle<Wry>, path: &str) -> Result<PathBuf, String> {
    let canonical = resolve_existing_regular_file(path, "video")?;
    let extension = canonical
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "Video file must have a supported extension".to_string())?;
    if !VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("Unsupported video extension: {extension}"));
    }
    if !app.fs_scope().is_allowed(&canonical) || !app.asset_protocol_scope().is_allowed(&canonical)
    {
        return Err("Video file is outside the picker-approved filesystem scope".to_string());
    }
    Ok(canonical)
}

fn resolve_existing_regular_file(path: &str, label: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} path cannot be empty"));
    }
    let candidate = PathBuf::from(trimmed);
    let metadata = fs::symlink_metadata(&candidate)
        .map_err(|error| format!("Failed to inspect {label} path: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "{label} path must be an existing non-symlink regular file"
        ));
    }
    fs::canonicalize(candidate).map_err(|error| format!("Failed to resolve {label} path: {error}"))
}

fn resolve_existing_directory(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Destination directory cannot be empty".to_string());
    }
    let canonical = fs::canonicalize(trimmed)
        .map_err(|error| format!("Failed to resolve destination directory: {error}"))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("Failed to inspect destination directory: {error}"))?;
    if !metadata.is_dir() || canonical.parent().is_none() {
        return Err("Destination must be an existing non-root directory".to_string());
    }
    Ok(canonical)
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

async fn persist_video_asset(
    app: tauri::AppHandle<Wry>,
    mut asset: VideoAssetRecord,
) -> Result<VideoImportOutcome, String> {
    run_blocking(app, move |conn| {
        let removed: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM removed_images WHERE id = ?1 OR path = ?2)",
                params![asset.id, asset.path],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value != 0)
            .map_err(|error| error.to_string())?;
        if removed {
            return Ok(VideoImportOutcome {
                status: "rejected".to_string(),
                asset: None,
                reason: Some("removedAsset: restore this asset before importing it again".to_string()),
            });
        }

        let existing: Option<(String, i64, i64)> = conn
            .query_row(
                "SELECT media_type, timestamp, file_size FROM images WHERE id = ?1 OR path = ?2 LIMIT 1",
                params![asset.id, asset.path],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if existing.as_ref().is_some_and(|(media_type, _, _)| media_type != "video") {
            return Ok(VideoImportOutcome {
                status: "rejected".to_string(),
                asset: None,
                reason: Some("pathCollision: an image already uses this path".to_string()),
            });
        }
        let status = if existing
            .as_ref()
            .is_some_and(|(_, timestamp, file_size)| *timestamp == asset.timestamp && *file_size >= 0 && *file_size as u64 == asset.file_size)
        {
            "duplicate"
        } else if existing.is_some() {
            "updated"
        } else {
            "imported"
        };

        asset.metadata = upsert_video_asset(conn, &asset)?;

        Ok(VideoImportOutcome {
            status: status.to_string(),
            asset: Some(asset),
            reason: None,
        })
    })
    .await
}

fn upsert_video_asset(
    conn: &rusqlite::Connection,
    asset: &VideoAssetRecord,
) -> Result<VideoGenerationMetadata, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let current_metadata_json: Option<String> = tx
        .query_row(
            "SELECT metadata_json FROM images WHERE id = ?1 AND media_type = 'video'",
            [&asset.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let mut metadata = asset.metadata.clone();
    if let Some(current_metadata_json) = current_metadata_json {
        preserve_video_user_overrides(&current_metadata_json, &mut metadata);
    }
    let metadata_json = serde_json::to_string(&metadata).map_err(|error| error.to_string())?;
    let original_parsed_json =
        serde_json::to_string(&asset.metadata).map_err(|error| error.to_string())?;
    tx.execute(
        UPSERT_VIDEO_ASSET_SQL,
        params![
            asset.id,
            asset.path,
            asset.width,
            asset.height,
            asset.file_size,
            asset.timestamp,
            metadata_json,
            asset.original_metadata_json,
            original_parsed_json,
            VIDEO_PARSER_VERSION,
            metadata.model,
            metadata.tool,
            metadata.steps,
            metadata.seed,
            metadata.cfg,
            metadata.sampler,
            metadata.generation_type,
            metadata.positive_prompt,
            metadata.negative_prompt,
            asset.media_container,
            asset.media_mime_type,
            asset.duration_ms,
            asset.video_codec,
            asset.video_profile,
            asset.audio_present,
            asset.audio_codec,
            asset.frame_rate_num,
            asset.frame_rate_den,
            asset.rotation_degrees,
        ],
    )
    .map_err(|error| error.to_string())?;
    refresh_video_resource_junctions(&tx, &asset.id, &metadata_json)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(metadata)
}

fn refresh_video_resource_junctions(
    conn: &rusqlite::Connection,
    asset_id: &str,
    metadata_json: &str,
) -> Result<(), String> {
    for table in ["image_loras", "image_controlnets", "image_ipadapters"] {
        conn.execute(
            &format!("DELETE FROM {table} WHERE image_id = ?1"),
            [asset_id],
        )
        .map_err(|error| error.to_string())?;
    }

    for (table, column, json_path) in [
        ("image_loras", "lora_name", "$.loras"),
        ("image_controlnets", "controlnet_name", "$.controlNets"),
        ("image_ipadapters", "ipadapter_name", "$.ipAdapters"),
    ] {
        conn.execute(
            &format!(
                "INSERT OR IGNORE INTO {table} (image_id, {column})
                 SELECT ?1,
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                        CASE
                            WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                            WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                            ELSE value
                        END,
                    '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')
                 FROM json_each(?2, '{json_path}')
                 WHERE value IS NOT NULL AND value != ''"
            ),
            params![asset_id, metadata_json],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn preserve_video_user_overrides(current_json: &str, next: &mut VideoGenerationMetadata) {
    let Ok(current) = serde_json::from_str::<Value>(current_json) else {
        return;
    };
    for (field, target) in [
        ("positivePrompt", &mut next.positive_prompt),
        ("negativePrompt", &mut next.negative_prompt),
        ("model", &mut next.model),
        ("generationType", &mut next.generation_type),
    ] {
        let Some(value) = current.get(field).and_then(Value::as_str) else {
            continue;
        };
        let is_override = current
            .pointer(&format!("/fieldSources/{field}"))
            .and_then(Value::as_str)
            == Some("user_override");
        if is_override {
            *target = value.to_string();
            next.field_sources
                .insert(field.to_string(), MetadataEvidenceSource::UserOverride);
        }
    }
    if current
        .pointer("/fieldSources/overrideModel")
        .and_then(Value::as_str)
        == Some("user_override")
    {
        if let Some(value) = current.get("overrideModel").and_then(Value::as_str) {
            next.model = value.to_string();
            next.field_sources
                .insert("model".into(), MetadataEvidenceSource::UserOverride);
        }
    }
    if current
        .pointer("/fieldSources/generationMode")
        .and_then(Value::as_str)
        == Some("user_override")
    {
        if let Some(value) = current.get("generationMode") {
            if let Ok(mode) = serde_json::from_value::<VideoGenerationMode>(value.clone()) {
                next.generation_mode = mode;
                next.field_sources.insert(
                    "generationMode".into(),
                    MetadataEvidenceSource::UserOverride,
                );
            }
        }
    }
}

fn update_video_metadata_record(
    conn: &rusqlite::Connection,
    asset_id: &str,
    parsed_metadata: &VideoGenerationMetadata,
) -> Result<VideoGenerationMetadata, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let current_json: String = tx
        .query_row(
            "SELECT metadata_json FROM images WHERE id = ?1 AND media_type = 'video'",
            [asset_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let mut metadata = parsed_metadata.clone();
    preserve_video_user_overrides(&current_json, &mut metadata);
    let metadata_json = serde_json::to_string(&metadata).map_err(|error| error.to_string())?;
    let original_parsed_json =
        serde_json::to_string(parsed_metadata).map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE images SET
            metadata_json = ?1,
            original_parsed_json = ?2,
            parser_version = ?3,
            model_name = ?4,
            tool = ?5,
            resolved_model_name = ?4,
            steps = ?6,
            seed = ?7,
            cfg = ?8,
            sampler = ?9,
            generation_type = ?10,
            positive_prompt = ?11,
            negative_prompt = ?12
         WHERE id = ?13 AND media_type = 'video'",
        params![
            metadata_json,
            original_parsed_json,
            VIDEO_PARSER_VERSION,
            metadata.model,
            metadata.tool,
            metadata.steps,
            metadata.seed,
            metadata.cfg,
            metadata.sampler,
            metadata.generation_type,
            metadata.positive_prompt,
            metadata.negative_prompt,
            asset_id,
        ],
    )
    .map_err(|error| error.to_string())?;
    refresh_video_resource_junctions(&tx, asset_id, &metadata_json)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(metadata)
}

async fn mark_known_video_probe_invalid(
    app: tauri::AppHandle<Wry>,
    normalized_path: String,
) -> Result<(), String> {
    run_blocking(app, move |conn| {
        conn.execute(
            "UPDATE images
             SET probe_status = 'invalid',
                 playback_status = 'external_required',
                 is_corrupt = 1
             WHERE media_type = 'video' AND (id = ?1 OR path = ?1)",
            [&normalized_path],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    })
    .await
}

#[cfg(windows)]
async fn run_mediainfo(
    app: &tauri::AppHandle<Wry>,
    path: &Path,
    cancel: &Arc<AtomicBool>,
) -> Result<ProbeMetadata, ProbeFailure> {
    match run_mediainfo_capture(
        app,
        path,
        cancel,
        &["--Output=JSON", "--Full", "--Language=raw"],
        FULL_STDOUT_LIMIT,
    )
    .await
    {
        Ok(stdout) => parse_mediainfo_json(&stdout),
        Err(failure) if failure.kind == ProbeFailureKind::OutputTooLarge => {
            let stdout = run_mediainfo_capture(
                app,
                path,
                cancel,
                &["--Output=JSON", "--Language=raw"],
                MINIMAL_STDOUT_LIMIT,
            )
            .await?;
            let mut probe = parse_mediainfo_json(&stdout)?;
            probe.full_metadata_truncated = true;
            Ok(probe)
        }
        Err(failure) => Err(failure),
    }
}

#[cfg(windows)]
async fn run_mediainfo_capture(
    app: &tauri::AppHandle<Wry>,
    path: &Path,
    cancel: &Arc<AtomicBool>,
    args: &[&str],
    stdout_limit: usize,
) -> Result<Vec<u8>, ProbeFailure> {
    let command = app
        .shell()
        .sidecar("mediainfo")
        .map_err(|error| ProbeFailure {
            kind: ProbeFailureKind::ToolUnavailable,
            message: error.to_string(),
        })?
        .args(args)
        .arg(path.as_os_str())
        .env_clear()
        .set_raw_out(true);
    let (mut events, child) = command.spawn().map_err(|error| ProbeFailure {
        kind: ProbeFailureKind::ToolUnavailable,
        message: error.to_string(),
    })?;

    let mut child = Some(child);
    let started = Instant::now();
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code = None;
    let mut forced_failure: Option<ProbeFailure> = None;
    let mut forced_at: Option<Instant> = None;

    loop {
        if forced_failure.is_none() && cancel.load(Ordering::Relaxed) {
            forced_failure = Some(ProbeFailure {
                kind: ProbeFailureKind::Cancelled,
                message: "Video import was cancelled".to_string(),
            });
            forced_at = Some(Instant::now());
            if let Some(child) = child.take() {
                let _ = child.kill();
            }
        } else if forced_failure.is_none() && started.elapsed() >= PROBE_TIMEOUT {
            forced_failure = Some(ProbeFailure::invalid("MediaInfo probe timed out"));
            forced_at = Some(Instant::now());
            if let Some(child) = child.take() {
                let _ = child.kill();
            }
        }

        let event = tokio::time::timeout(PROBE_POLL_INTERVAL, events.recv()).await;
        match event {
            Ok(Some(CommandEvent::Stdout(bytes))) => {
                if stdout.len().saturating_add(bytes.len()) > stdout_limit {
                    forced_failure = Some(ProbeFailure {
                        kind: ProbeFailureKind::OutputTooLarge,
                        message: format!("MediaInfo stdout exceeded {stdout_limit} bytes"),
                    });
                    forced_at.get_or_insert_with(Instant::now);
                    if let Some(child) = child.take() {
                        let _ = child.kill();
                    }
                } else {
                    stdout.extend(bytes);
                }
            }
            Ok(Some(CommandEvent::Stderr(bytes))) => {
                let remaining = STDERR_LIMIT.saturating_sub(stderr.len());
                stderr.extend(bytes.into_iter().take(remaining));
            }
            Ok(Some(CommandEvent::Terminated(payload))) => {
                exit_code = payload.code;
                break;
            }
            Ok(Some(CommandEvent::Error(error))) => {
                forced_failure.get_or_insert_with(|| ProbeFailure::invalid(error));
                forced_at.get_or_insert_with(Instant::now);
            }
            Ok(None) => break,
            Err(_) => {}
            Ok(Some(_)) => {}
        }
        if forced_at.is_some_and(|instant| instant.elapsed() >= PROBE_REAP_TIMEOUT) {
            break;
        }
    }

    if let Some(failure) = forced_failure {
        return Err(failure);
    }
    if exit_code != Some(0) {
        let detail = String::from_utf8_lossy(&stderr).trim().to_string();
        return Err(ProbeFailure::invalid(if detail.is_empty() {
            format!("MediaInfo exited with status {exit_code:?}")
        } else {
            format!("MediaInfo exited with status {exit_code:?}: {detail}")
        }));
    }

    Ok(stdout)
}

#[cfg(not(windows))]
async fn run_mediainfo(
    _app: &tauri::AppHandle<Wry>,
    _path: &Path,
    _cancel: &Arc<AtomicBool>,
) -> Result<ProbeMetadata, ProbeFailure> {
    Err(ProbeFailure {
        kind: ProbeFailureKind::ToolUnavailable,
        message: "Video probing is available in Windows builds only".to_string(),
    })
}

fn parse_mediainfo_json(bytes: &[u8]) -> Result<ProbeMetadata, ProbeFailure> {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let root: Value = serde_json::from_slice(bytes).map_err(|error| {
        ProbeFailure::invalid(format!("MediaInfo returned invalid JSON: {error}"))
    })?;
    let tracks = root
        .pointer("/media/track")
        .and_then(Value::as_array)
        .ok_or_else(|| ProbeFailure::invalid("MediaInfo response has no track array"))?;
    let general = tracks
        .iter()
        .find(|track| field(track, "@type").as_deref() == Some("General"));
    let video = tracks
        .iter()
        .find(|track| field(track, "@type").as_deref() == Some("Video"))
        .ok_or_else(|| ProbeFailure::invalid("MediaInfo found no video track"))?;
    let audio = tracks
        .iter()
        .find(|track| field(track, "@type").as_deref() == Some("Audio"));

    let width = positive_u32(video, "Width")
        .ok_or_else(|| ProbeFailure::invalid("Video width is missing or invalid"))?;
    let height = positive_u32(video, "Height")
        .ok_or_else(|| ProbeFailure::invalid("Video height is missing or invalid"))?;
    let duration_seconds = number(video, "Duration")
        .or_else(|| general.and_then(|track| number(track, "Duration")))
        .filter(|duration| duration.is_finite() && *duration > 0.0)
        .ok_or_else(|| ProbeFailure::invalid("Video duration is missing or invalid"))?;
    let duration_ms = (duration_seconds * 1000.0).round();
    if duration_ms < 1.0 || duration_ms > u64::MAX as f64 {
        return Err(ProbeFailure::invalid(
            "Video duration is outside supported bounds",
        ));
    }
    let video_codec = field(video, "Format")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ProbeFailure::invalid("Video codec is missing"))?;
    let rotation_degrees = normalize_rotation(number(video, "Rotation").unwrap_or(0.0))?;
    let (frame_rate_num, frame_rate_den) = frame_rate(video);

    Ok(ProbeMetadata {
        width,
        height,
        container: general.and_then(|track| field(track, "Format")),
        mime_type: general.and_then(|track| field(track, "InternetMediaType")),
        duration_ms: duration_ms as u64,
        video_codec,
        video_profile: field(video, "Format_Profile"),
        audio_present: audio.is_some(),
        audio_codec: audio.and_then(|track| field(track, "Format")),
        frame_rate_num,
        frame_rate_den,
        rotation_degrees,
        raw_mediainfo: root,
        full_metadata_truncated: false,
    })
}

fn field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|value| match value {
        Value::String(text) => Some(text.trim().to_string()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    })
}

fn number(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(|value| match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().replace(' ', "").parse::<f64>().ok(),
        _ => None,
    })
}

fn positive_u32(value: &Value, key: &str) -> Option<u32> {
    let number = number(value, key)?;
    if number.is_finite() && number > 0.0 && number <= u32::MAX as f64 {
        Some(number.round() as u32)
    } else {
        None
    }
}

fn frame_rate(video: &Value) -> (Option<u32>, Option<u32>) {
    let numerator = positive_u32(video, "FrameRate_Num");
    let denominator = positive_u32(video, "FrameRate_Den");
    if numerator.is_some() && denominator.is_some() {
        return (numerator, denominator);
    }
    let Some(rate) = number(video, "FrameRate").filter(|rate| rate.is_finite() && *rate > 0.0)
    else {
        return (None, None);
    };
    let numerator = (rate * 1000.0).round().clamp(1.0, u32::MAX as f64) as u32;
    let divisor = gcd(numerator, 1000);
    (Some(numerator / divisor), Some(1000 / divisor))
}

fn gcd(mut left: u32, mut right: u32) -> u32 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left.max(1)
}

fn normalize_rotation(rotation: f64) -> Result<u16, ProbeFailure> {
    if !rotation.is_finite() {
        return Err(ProbeFailure::invalid("Video rotation is invalid"));
    }
    let normalized = ((rotation.round() as i64 % 360) + 360) % 360;
    match normalized {
        0 | 90 | 180 | 270 => Ok(normalized as u16),
        _ => Err(ProbeFailure::invalid(format!(
            "Unsupported video rotation: {rotation}"
        ))),
    }
}

fn decode_and_validate_poster(value: &str) -> Result<Vec<u8>, String> {
    let encoded = value
        .strip_prefix("data:image/webp;base64,")
        .unwrap_or(value)
        .trim();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("Video poster is not valid base64: {error}"))?;
    if bytes.is_empty() || bytes.len() > POSTER_LIMIT {
        return Err("Video poster must be between 1 byte and 2 MiB".to_string());
    }
    let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::WebP)
        .map_err(|error| format!("Video poster is not valid WebP: {error}"))?;
    if image.width() == 0 || image.height() == 0 || image.width() > 512 || image.height() > 512 {
        return Err("Video poster dimensions must be between 1x1 and 512x512".to_string());
    }
    Ok(bytes)
}

fn collision_safe_output_path(source: &Path, destination: &Path) -> Result<PathBuf, String> {
    let file_name = source
        .file_name()
        .ok_or_else(|| "Source asset has no filename".to_string())?;
    let direct = destination.join(file_name);
    if !direct.exists() {
        return Ok(direct);
    }

    let stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| "Source asset filename is not valid Unicode".to_string())?;
    let extension = source.extension().and_then(|extension| extension.to_str());
    for suffix in 1..=10_000u32 {
        let name = match extension {
            Some(extension) => format!("{stem} ({suffix}).{extension}"),
            None => format!("{stem} ({suffix})"),
        };
        let candidate = destination.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not find an unused export filename".to_string())
}

fn copy_without_overwrite(source: &Path, destination: &Path) -> Result<(PathBuf, u64), String> {
    for _ in 0..=10_000u32 {
        let output = collision_safe_output_path(source, destination)?;
        let mut destination_file = match OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&output)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Failed to create exported asset: {error}")),
        };
        let copy_result = (|| {
            let mut source_file = fs::File::open(source)
                .map_err(|error| format!("Failed to open source asset: {error}"))?;
            let bytes = std::io::copy(&mut source_file, &mut destination_file)
                .map_err(|error| format!("Failed to export original asset: {error}"))?;
            destination_file
                .flush()
                .map_err(|error| format!("Failed to flush exported asset: {error}"))?;
            Ok::<u64, String>(bytes)
        })();
        match copy_result {
            Ok(bytes) => return Ok((output, bytes)),
            Err(error) => {
                drop(destination_file);
                let _ = fs::remove_file(&output);
                return Err(error);
            }
        }
    }
    Err("Could not reserve an unused export filename".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        collision_safe_output_path, copy_without_overwrite, load_video_playback_path,
        normalize_rotation, parse_mediainfo_json, preserve_video_user_overrides,
        upsert_video_asset, VideoAssetRecord,
    };
    use crate::metadata::video::{
        MetadataEvidenceSource, VideoGenerationMetadata, VideoGenerationMode,
    };
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn parses_sane_mediainfo_video_tracks() {
        let json = br#"{
            "media": {"track": [
                {"@type":"General","Format":"MPEG-4","InternetMediaType":"video/mp4","Duration":"2.5"},
                {"@type":"Video","Format":"AVC","Format_Profile":"High","Width":"1920","Height":"1080","FrameRate_Num":"30000","FrameRate_Den":"1001","Rotation":"0"},
                {"@type":"Audio","Format":"AAC"}
            ]}
        }"#;
        let parsed = parse_mediainfo_json(json).expect("valid MediaInfo response");
        assert_eq!(parsed.duration_ms, 2500);
        assert_eq!((parsed.width, parsed.height), (1920, 1080));
        assert_eq!(
            (parsed.frame_rate_num, parsed.frame_rate_den),
            (Some(30000), Some(1001))
        );
        assert!(parsed.audio_present);
        assert_eq!(parsed.audio_codec.as_deref(), Some("AAC"));
    }

    #[test]
    fn rejects_json_without_a_sane_video_track() {
        assert!(parse_mediainfo_json(br#"{"media":{"track":[]}}"#).is_err());
        assert!(parse_mediainfo_json(
            br#"{"media":{"track":[{"@type":"Video","Format":"AVC","Width":"0","Height":"1080","Duration":"1"}]}}"#
        )
        .is_err());
    }

    #[test]
    fn rotation_accepts_only_quarter_turns() {
        assert_eq!(normalize_rotation(-90.0).unwrap(), 270);
        assert_eq!(normalize_rotation(360.0).unwrap(), 0);
        assert!(normalize_rotation(45.0).is_err());
    }

    #[test]
    fn video_reparse_preserves_only_explicit_user_overrides() {
        let current = serde_json::json!({
            "model": "parsed-old.safetensors",
            "overrideModel": "chosen.safetensors",
            "positivePrompt": "chosen prompt",
            "negativePrompt": "old negative",
            "generationType": "text_to_video",
            "generationMode": "text_to_video",
            "fieldSources": {
                "overrideModel": "user_override",
                "positivePrompt": "user_override",
                "negativePrompt": "embedded",
                "generationType": "trusted_sidecar",
                "generationMode": "user_override"
            }
        });
        let mut next = VideoGenerationMetadata {
            model: "parsed-new.safetensors".into(),
            positive_prompt: "new parsed prompt".into(),
            negative_prompt: "new parsed negative".into(),
            generation_type: "guided_video".into(),
            ..VideoGenerationMetadata::default()
        };

        preserve_video_user_overrides(&current.to_string(), &mut next);

        assert_eq!(next.model, "chosen.safetensors");
        assert_eq!(next.positive_prompt, "chosen prompt");
        assert_eq!(next.negative_prompt, "new parsed negative");
        assert_eq!(next.generation_type, "guided_video");
        assert_eq!(next.generation_mode, VideoGenerationMode::TextToVideo);
        assert_eq!(
            next.field_sources["positivePrompt"],
            MetadataEvidenceSource::UserOverride
        );
    }

    #[test]
    fn playback_path_can_be_loaded_from_removed_video_records() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE images (
                id TEXT PRIMARY KEY, path TEXT NOT NULL, media_type TEXT NOT NULL,
                is_deleted INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE removed_images (
                id TEXT PRIMARY KEY, path TEXT NOT NULL, media_type TEXT NOT NULL
             );
             INSERT INTO removed_images (id, path, media_type)
             VALUES ('removed-video', 'C:/videos/removed.webm', 'video');",
        )
        .expect("setup playback lookup schema");

        assert_eq!(
            load_video_playback_path(&conn, "removed-video")
                .unwrap()
                .as_deref(),
            Some("C:/videos/removed.webm")
        );
    }

    #[test]
    fn export_filename_never_overwrites_an_existing_file() {
        let root = std::env::temp_dir().join(format!(
            "ambit_video_export_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("clip.mp4"), b"existing").unwrap();
        fs::write(root.join("clip (1).mp4"), b"existing").unwrap();

        let output = collision_safe_output_path(&root.join("clip.mp4"), &root).unwrap();
        assert_eq!(output.file_name().unwrap(), "clip (2).mp4");

        let source = root.join("source.mp4");
        fs::write(&source, b"original bytes").unwrap();
        let (copied, bytes) = copy_without_overwrite(&source, &root).unwrap();
        assert_eq!(bytes, 14);
        assert_eq!(copied.file_name().unwrap(), "source (1).mp4");
        assert_eq!(fs::read(copied).unwrap(), b"original bytes");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn changed_video_resets_derived_playback_and_poster_state_but_duplicate_preserves_it() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                file_size INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                metadata_json TEXT NOT NULL,
                original_metadata_json TEXT,
                original_parsed_json TEXT,
                parser_version INTEGER,
                model_name TEXT,
                tool TEXT,
                resolved_model_name TEXT,
                steps INTEGER,
                seed INTEGER,
                cfg REAL,
                sampler TEXT,
                generation_type TEXT,
                positive_prompt TEXT,
                negative_prompt TEXT,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                is_missing INTEGER NOT NULL DEFAULT 0,
                is_corrupt INTEGER NOT NULL DEFAULT 0,
                media_type TEXT NOT NULL,
                media_container TEXT,
                media_mime_type TEXT,
                duration_ms INTEGER,
                video_codec TEXT,
                video_profile TEXT,
                audio_present INTEGER,
                audio_codec TEXT,
                frame_rate_num INTEGER,
                frame_rate_den INTEGER,
                rotation_degrees INTEGER,
                probe_status TEXT NOT NULL,
                playback_status TEXT NOT NULL,
                thumbnail_path TEXT,
                micro_thumbnail BLOB,
                thumbnail_source TEXT,
                thumbnail_version INTEGER NOT NULL DEFAULT 1,
                thumbnail_failure_count INTEGER NOT NULL DEFAULT 0,
                thumbnail_last_error TEXT,
                thumbnail_last_attempt_at INTEGER
            );
            CREATE TABLE image_loras (
                image_id TEXT NOT NULL,
                lora_name TEXT NOT NULL,
                UNIQUE(image_id, lora_name)
            );
            CREATE TABLE image_controlnets (
                image_id TEXT NOT NULL,
                controlnet_name TEXT NOT NULL,
                UNIQUE(image_id, controlnet_name)
            );
            CREATE TABLE image_ipadapters (
                image_id TEXT NOT NULL,
                ipadapter_name TEXT NOT NULL,
                UNIQUE(image_id, ipadapter_name)
            );
            ",
        )
        .expect("setup schema");

        let mut asset = VideoAssetRecord {
            id: "C:/videos/clip.mp4".into(),
            path: "C:/videos/clip.mp4".into(),
            width: 1920,
            height: 1080,
            file_size: 100,
            timestamp: 10,
            media_container: Some("MPEG-4".into()),
            media_mime_type: Some("video/mp4".into()),
            duration_ms: 2500,
            video_codec: "AVC".into(),
            video_profile: Some("High".into()),
            audio_present: true,
            audio_codec: Some("AAC".into()),
            frame_rate_num: Some(30),
            frame_rate_den: Some(1),
            rotation_degrees: 0,
            metadata: VideoGenerationMetadata::default(),
            original_metadata_json: "{}".into(),
        };
        upsert_video_asset(&conn, &asset).expect("initial import");
        conn.execute(
            "UPDATE images SET
                playback_status = 'external_required',
                thumbnail_path = 'old.webp',
                micro_thumbnail = X'0102',
                thumbnail_source = 'ambit-video-v1',
                thumbnail_version = 1,
                thumbnail_failure_count = 2,
                thumbnail_last_error = 'old failure',
                thumbnail_last_attempt_at = 99",
            [],
        )
        .expect("seed derived state");

        asset.file_size = 200;
        asset.timestamp = 20;
        upsert_video_asset(&conn, &asset).expect("changed import");
        let changed: (
            String,
            Option<String>,
            Option<Vec<u8>>,
            Option<String>,
            i64,
            i64,
            Option<String>,
            Option<i64>,
        ) = conn
            .query_row(
                "SELECT playback_status, thumbnail_path, micro_thumbnail, thumbnail_source,
                        thumbnail_version, thumbnail_failure_count, thumbnail_last_error,
                        thumbnail_last_attempt_at FROM images WHERE id = ?1",
                [&asset.id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                    ))
                },
            )
            .expect("changed state");
        assert_eq!(
            changed,
            ("unknown".into(), None, None, None, 0, 0, None, None)
        );

        conn.execute(
            "UPDATE images SET playback_status = 'playable', thumbnail_path = 'fresh.webp',
                thumbnail_source = 'ambit-video-v1', thumbnail_version = 1",
            [],
        )
        .expect("seed duplicate state");
        upsert_video_asset(&conn, &asset).expect("duplicate import");
        let duplicate: (String, Option<String>, Option<String>, i64) = conn
            .query_row(
                "SELECT playback_status, thumbnail_path, thumbnail_source, thumbnail_version
                 FROM images WHERE id = ?1",
                [&asset.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("duplicate state");
        assert_eq!(
            duplicate,
            (
                "playable".into(),
                Some("fresh.webp".into()),
                Some("ambit-video-v1".into()),
                1
            )
        );

        conn.execute(
            "UPDATE images SET metadata_json = json_set(metadata_json,
                '$.positivePrompt', 'chosen prompt',
                '$.fieldSources.positivePrompt', 'user_override') WHERE id = ?1",
            [&asset.id],
        )
        .expect("seed video override");
        asset.metadata.positive_prompt = "new parsed prompt".into();
        let persisted = upsert_video_asset(&conn, &asset).expect("metadata re-import");
        assert_eq!(persisted.positive_prompt, "chosen prompt");
        let stored: (String, String) = conn
            .query_row(
                "SELECT json_extract(metadata_json, '$.positivePrompt'),
                        json_extract(original_parsed_json, '$.positivePrompt')
                 FROM images WHERE id = ?1",
                [&asset.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("stored metadata baselines");
        assert_eq!(stored, ("chosen prompt".into(), "new parsed prompt".into()));

        asset.metadata.loras = vec!["MotionDetail.safetensors (0.8)".into()];
        asset.metadata.control_nets = vec!["CannyVideo.ckpt".into()];
        asset.metadata.ip_adapters = vec!["ReferenceFace.bin".into()];
        upsert_video_asset(&conn, &asset).expect("resource import");
        let resources: (String, String, String) = conn
            .query_row(
                "SELECT
                    (SELECT lora_name FROM image_loras WHERE image_id = ?1),
                    (SELECT controlnet_name FROM image_controlnets WHERE image_id = ?1),
                    (SELECT ipadapter_name FROM image_ipadapters WHERE image_id = ?1)",
                [&asset.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("video resource junctions");
        assert_eq!(
            resources,
            (
                "MotionDetail".into(),
                "CannyVideo".into(),
                "ReferenceFace".into()
            )
        );

        asset.metadata.loras = vec!["ReplacementLora.pt".into()];
        asset.metadata.control_nets.clear();
        asset.metadata.ip_adapters.clear();
        upsert_video_asset(&conn, &asset).expect("resource replacement");
        let resource_counts: (i64, i64, i64) = conn
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM image_loras WHERE image_id = ?1),
                    (SELECT COUNT(*) FROM image_controlnets WHERE image_id = ?1),
                    (SELECT COUNT(*) FROM image_ipadapters WHERE image_id = ?1)",
                [&asset.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("replaced video resource junctions");
        assert_eq!(resource_counts, (1, 0, 0));
        assert_eq!(
            conn.query_row(
                "SELECT lora_name FROM image_loras WHERE image_id = ?1",
                [&asset.id],
                |row| row.get::<_, String>(0),
            )
            .expect("replacement LoRA"),
            "ReplacementLora"
        );
    }
}
