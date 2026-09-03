use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

const MAX_LAUNCH_IDS: usize = 8;
const MAX_EVENTS_PER_LAUNCH: usize = 256;
const MAX_DIAGNOSTIC_TIME_MS: u64 = 24 * 60 * 60 * 1_000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupPhase {
    Database,
    DatabaseSchema,
    DatabaseOptimization,
    OwnerDiscovery,
    OwnerCache,
    Facets,
    Collections,
    Privacy,
    FirstPage,
    Splash,
    Ready,
    ThumbnailMaintenance,
    MetadataMaintenance,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupPhaseStatus {
    Started,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupCacheAction {
    Restored,
    Selective,
    Full,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StartupDiagnosticEvent {
    pub launch_id: String,
    pub phase: StartupPhase,
    pub status: StartupPhaseStatus,
    pub elapsed_ms: u64,
    pub duration_ms: Option<u64>,
    pub cache_action: Option<StartupCacheAction>,
}

pub struct StartupState {
    process_started: Instant,
    ready: AtomicBool,
    backup_scheduled: AtomicBool,
    events_per_launch: Mutex<BTreeMap<String, usize>>,
}

impl StartupState {
    pub fn new(process_started: Instant) -> Self {
        Self {
            process_started,
            ready: AtomicBool::new(false),
            backup_scheduled: AtomicBool::new(false),
            events_per_launch: Mutex::new(BTreeMap::new()),
        }
    }

    fn complete_and_claim_backup(&self, development_build: bool) -> bool {
        if self.ready.swap(true, Ordering::AcqRel) || development_build {
            return false;
        }

        !self.backup_scheduled.swap(true, Ordering::AcqRel)
    }

    #[cfg(test)]
    fn is_backup_scheduled(&self) -> bool {
        self.backup_scheduled.load(Ordering::Acquire)
    }

    fn record_diagnostic(&self, event: &StartupDiagnosticEvent) -> Result<(), String> {
        validate_diagnostic(event)?;

        let mut events_per_launch = self
            .events_per_launch
            .lock()
            .map_err(|_| "Startup diagnostics state is unavailable".to_string())?;
        let event_count = match events_per_launch.get_mut(&event.launch_id) {
            Some(event_count) => event_count,
            None => {
                if events_per_launch.len() >= MAX_LAUNCH_IDS {
                    return Err("Startup diagnostic launch limit reached".to_string());
                }
                events_per_launch.insert(event.launch_id.clone(), 0);
                events_per_launch
                    .get_mut(&event.launch_id)
                    .expect("startup diagnostic launch was inserted")
            }
        };

        if *event_count >= MAX_EVENTS_PER_LAUNCH {
            return Err("Startup diagnostic event limit reached".to_string());
        }
        *event_count += 1;
        Ok(())
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn record_startup_diagnostic(
    event: StartupDiagnosticEvent,
    state: tauri::State<'_, StartupState>,
) -> Result<(), String> {
    state.record_diagnostic(&event)?;

    let diagnostic = serde_json::json!({
        "event": event,
        "processElapsedMs": elapsed_ms(state.process_started),
    });
    log::info!("[Startup] {diagnostic}");
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn complete_startup(app: tauri::AppHandle, state: tauri::State<'_, StartupState>) {
    if !state.complete_and_claim_backup(cfg!(debug_assertions)) {
        if cfg!(debug_assertions) {
            log::info!("[Backup] Auto-backup skipped in development build");
        }
        return;
    }

    schedule_automatic_backup(app, state.process_started);
}

fn validate_diagnostic(event: &StartupDiagnosticEvent) -> Result<(), String> {
    if event.launch_id.is_empty()
        || event.launch_id.len() > 64
        || !event
            .launch_id
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
    {
        return Err("Startup diagnostic launch ID is invalid".to_string());
    }

    validate_diagnostic_time("elapsedMs", event.elapsed_ms)?;
    if let Some(duration_ms) = event.duration_ms {
        validate_diagnostic_time("durationMs", duration_ms)?;
    }
    Ok(())
}

fn validate_diagnostic_time(field: &str, value: u64) -> Result<(), String> {
    if value > MAX_DIAGNOSTIC_TIME_MS {
        return Err(format!("Startup diagnostic {field} is out of range"));
    }
    Ok(())
}

fn schedule_automatic_backup(app: tauri::AppHandle, process_started: Instant) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(120)).await;
        let backup_started = Instant::now();
        log_backup_event("start", "started", Duration::ZERO, process_started);

        let outcome = match crate::db::backup::check_and_run_autobackup(app).await {
            Ok(Some(_)) => "created",
            Ok(None) => "skipped",
            Err(_) => "failed",
        };
        log_backup_event("end", outcome, backup_started.elapsed(), process_started);
    });
}

fn log_backup_event(phase: &str, outcome: &str, duration: Duration, process_started: Instant) {
    let event = serde_json::json!({
        "event": "startup_backup",
        "phase": phase,
        "outcome": outcome,
        "durationMs": duration_ms(duration),
        "processElapsedMs": elapsed_ms(process_started),
    });
    log::info!("[Backup] {event}");
}

fn elapsed_ms(started: Instant) -> u64 {
    duration_ms(started.elapsed())
}

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::StartupState;
    use std::time::Instant;

    #[test]
    fn automatic_backup_is_not_scheduled_before_startup_is_completed() {
        let state = StartupState::new(Instant::now());

        assert!(!state.is_backup_scheduled());
    }

    #[test]
    fn completing_startup_schedules_automatic_backup_once() {
        let state = StartupState::new(Instant::now());

        assert!(state.complete_and_claim_backup(false));
        assert!(!state.complete_and_claim_backup(false));
    }

    #[test]
    fn development_build_completion_does_not_schedule_automatic_backup() {
        let state = StartupState::new(Instant::now());

        assert!(!state.complete_and_claim_backup(true));
        assert!(!state.is_backup_scheduled());
    }
}
