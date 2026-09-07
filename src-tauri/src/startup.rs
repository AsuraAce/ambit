use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const MAX_LAUNCH_IDS: usize = 8;
const MAX_EVENTS_PER_LAUNCH: usize = 256;
const MAX_DIAGNOSTIC_TIME_MS: u64 = 24 * 60 * 60 * 1_000;
const MAX_REPAIR_COUNT: u64 = 1_000_000_000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupPhase {
    FrontendEntry,
    ReactMount,
    StartupFailure,
    RendererStall,
    MaintenanceCounts,
    InvokeCatchUp,
    Database,
    DatabaseSchema,
    DatabaseOptimization,
    DatabasePragmas,
    DatabaseIndexes,
    OwnerDiscovery,
    OwnerSourceOpen,
    OwnerSourceSchema,
    OwnerSourceImages,
    OwnerSourceBoards,
    OwnerFingerprint,
    OwnerSourceRepair,
    OwnerBoardRead,
    OwnerBoardWrite,
    OwnerVisibility,
    OwnerBoardVerification,
    OwnerPreparation,
    OwnerCache,
    Facets,
    Collections,
    CollectionRows,
    CollectionCounts,
    Privacy,
    FirstPage,
    GalleryRows,
    GalleryCount,
    GalleryGlobalCount,
    StatisticsMedia,
    StatisticsSteps,
    StatisticsModels,
    FacetCounts,
    Splash,
    Ready,
    ThumbnailMaintenance,
    MetadataMaintenance,
    OwnerRepairDecision,
    OwnerRepairStage,
    OwnerRepairReport,
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
pub enum StartupLifecycleStage {
    CloseRequested,
    SettingsDrainStarted,
    SettingsDrainCompleted,
    SettingsDrainFailed,
    SettingsFlushStarted,
    SettingsFlushCompleted,
    SettingsFlushFailed,
    ExitInvoked,
    ExitFailed,
}

impl StartupLifecycleStage {
    fn label(self) -> &'static str {
        match self {
            Self::CloseRequested => "close-requested",
            Self::SettingsDrainStarted => "settings-drain-started",
            Self::SettingsDrainCompleted => "settings-drain-completed",
            Self::SettingsDrainFailed => "settings-drain-failed",
            Self::SettingsFlushStarted => "settings-flush-started",
            Self::SettingsFlushCompleted => "settings-flush-completed",
            Self::SettingsFlushFailed => "settings-flush-failed",
            Self::ExitInvoked => "exit-invoked",
            Self::ExitFailed => "exit-failed",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupCacheAction {
    Restored,
    Selective,
    Full,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupDatabaseRole {
    Ambit,
    InvokeSource,
    Mixed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupFailureKind {
    ScriptLoad,
    UncaughtError,
    UnhandledRejection,
    RenderError,
    DatabaseBusy,
    DatabaseLocked,
    Other,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupRepairDecisionKind {
    Unchanged,
    IncrementalCatchUp,
    FullRepair,
    NoAdmittedScope,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupRepairScope {
    None,
    Legacy,
    All,
    Owner,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupRepairSnapshot {
    Missing,
    Compatible,
    Incompatible,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupRepairFingerprint {
    Unavailable,
    Supported,
    Unsupported,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupRepairCountComparison {
    Unavailable,
    Decreased,
    Equal,
    Increased,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupRepairTimestampComparison {
    Unavailable,
    SavedAbsent,
    CurrentAbsent,
    Decreased,
    Equal,
    Increased,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartupRepairDecision {
    pub decision: StartupRepairDecisionKind,
    pub scope: StartupRepairScope,
    pub forced_refresh: bool,
    pub snapshot: StartupRepairSnapshot,
    pub saved_fingerprint: StartupRepairFingerprint,
    pub current_fingerprint: StartupRepairFingerprint,
    pub count_comparison: StartupRepairCountComparison,
    pub timestamp_comparison: StartupRepairTimestampComparison,
    pub fingerprint_current: Option<bool>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupRepairStage {
    Setup,
    Identity,
    LegacyPaths,
    Inventory,
    Facts,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum StartupRepairMetricOperation {
    Setup,
    IdentityRead,
    IdentityPaths,
    IdentityMatching,
    LegacyPaths,
    Inventory,
    FactRead,
    FactPaths,
    FactExtraction,
    FactWrite,
    ReferenceWrite,
    BatchYield,
    FilesystemEnumeration,
    InventoryBuild,
}

impl StartupRepairMetricOperation {
    const ALL: [Self; 14] = [
        Self::Setup,
        Self::IdentityRead,
        Self::IdentityPaths,
        Self::IdentityMatching,
        Self::LegacyPaths,
        Self::Inventory,
        Self::FactRead,
        Self::FactPaths,
        Self::FactExtraction,
        Self::FactWrite,
        Self::ReferenceWrite,
        Self::BatchYield,
        Self::FilesystemEnumeration,
        Self::InventoryBuild,
    ];
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartupRepairMetric {
    pub operation: StartupRepairMetricOperation,
    pub calls: u64,
    pub total_ms: u64,
    pub max_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartupRepairCounters {
    pub identity_rows: u64,
    pub fact_rows: u64,
    pub paths_checked: u64,
    pub inventory_submitted: u64,
    pub inventory_applied: u64,
    pub facts_submitted: u64,
    pub facts_applied: u64,
    pub reference_sets_submitted: u64,
    pub reference_sources_replaced: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StartupRepairStatus {
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartupRepairReport {
    pub status: StartupRepairStatus,
    pub duration_ms: u64,
    pub unattributed_ms: u64,
    pub metrics: Vec<StartupRepairMetric>,
    pub counters: StartupRepairCounters,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartupDiagnosticEvent {
    pub launch_id: String,
    pub phase: StartupPhase,
    pub status: StartupPhaseStatus,
    pub elapsed_ms: u64,
    pub duration_ms: Option<u64>,
    pub cache_action: Option<StartupCacheAction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database_role: Option<StartupDatabaseRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_kind: Option<StartupFailureKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repair_decision: Option<StartupRepairDecision>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repair_stage: Option<StartupRepairStage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repair_report: Option<StartupRepairReport>,
}

pub struct StartupState {
    pub journal: Arc<crate::startup_log::StartupJournal>,
    process_started: Instant,
    ready: AtomicBool,
    backup_scheduled: AtomicBool,
    events_per_launch: Mutex<BTreeMap<String, usize>>,
    reserved_events: Mutex<std::collections::BTreeSet<String>>,
    repair_events: Mutex<std::collections::BTreeSet<String>>,
}

impl StartupState {
    #[cfg(test)]
    pub fn new(process_started: Instant) -> Self {
        Self::with_journal(
            process_started,
            Arc::new(crate::startup_log::StartupJournal::new(
                process_started,
                None,
            )),
        )
    }

    pub fn with_journal(
        process_started: Instant,
        journal: Arc<crate::startup_log::StartupJournal>,
    ) -> Self {
        Self {
            journal,
            process_started,
            ready: AtomicBool::new(false),
            backup_scheduled: AtomicBool::new(false),
            events_per_launch: Mutex::new(BTreeMap::new()),
            reserved_events: Mutex::new(std::collections::BTreeSet::new()),
            repair_events: Mutex::new(std::collections::BTreeSet::new()),
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

        if is_repair(event.phase) {
            let mut repair_events = self
                .repair_events
                .lock()
                .map_err(|_| "Startup diagnostics state is unavailable".to_string())?;
            let key = match event.phase {
                StartupPhase::OwnerRepairStage => {
                    format!("{:?}:{:?}", event.phase, event.repair_stage)
                }
                StartupPhase::OwnerRepairDecision | StartupPhase::OwnerRepairReport => {
                    format!("{:?}", event.phase)
                }
                _ => unreachable!("repair phase was checked"),
            };
            if !repair_events.insert(key) {
                return Err("Startup repair diagnostic already recorded".to_string());
            }
            return Ok(());
        }

        if crate::startup_log::is_reserved(event.phase) {
            let mut reserved = self
                .reserved_events
                .lock()
                .map_err(|_| "Startup diagnostics state is unavailable".to_string())?;
            let key = format!("{:?}:{:?}", event.phase, event.status);
            if !reserved.insert(key) {
                return Err("Startup milestone already recorded".to_string());
            }
            return Ok(());
        }

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
    let receipt_ms = state.journal.elapsed_ms();
    if event.launch_id != state.journal.launch_id {
        return Err("Startup diagnostic launch ID does not match this process".to_string());
    }
    state.record_diagnostic(&event)?;
    state.journal.enqueue_renderer(event, receipt_ms)
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StartupLaunch {
    pub launch_id: String,
    pub process_elapsed_ms: u64,
    pub sql_trace_enabled: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupSqlLabel {
    Collection,
    Maintenance,
    Gallery,
    GlobalGallery,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum StartupSqlStatus {
    Completed,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartupSqlFrontend {
    pub launch_id: String,
    pub call_id: u32,
    pub label: StartupSqlLabel,
    pub duration_ms: u64,
    pub status: StartupSqlStatus,
}

/// Best effort only: reporting never authorizes another SQL operation.
#[tauri::command]
#[specta::specta]
pub fn record_startup_sql_frontend(
    report: StartupSqlFrontend,
    state: tauri::State<'_, StartupState>,
) {
    state.journal.sql_frontend(report);
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn record_startup_heartbeat(
    launch_id: String,
    state: tauri::State<'_, StartupState>,
) -> Result<(), String> {
    state.journal.heartbeat(&launch_id)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn record_startup_lifecycle(
    launch_id: String,
    stage: StartupLifecycleStage,
    state: tauri::State<'_, StartupState>,
) -> Result<(), String> {
    state.journal.lifecycle(&launch_id, stage.label())
}

#[tauri::command]
#[specta::specta]
pub fn get_startup_launch(state: tauri::State<'_, StartupState>) -> StartupLaunch {
    StartupLaunch {
        launch_id: state.journal.launch_id.clone(),
        process_elapsed_ms: state.journal.elapsed_ms(),
        sql_trace_enabled: state.journal.sql_trace_enabled(),
    }
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
    validate_repair_diagnostic(event)?;
    Ok(())
}

fn validate_repair_diagnostic(event: &StartupDiagnosticEvent) -> Result<(), String> {
    let repair_fields = (
        event.repair_decision.is_some(),
        event.repair_stage.is_some(),
        event.repair_report.is_some(),
    );
    match event.phase {
        StartupPhase::OwnerRepairDecision => {
            if !matches!(event.status, StartupPhaseStatus::Completed)
                || event.duration_ms.is_some()
                || repair_fields != (true, false, false)
            {
                return Err("Startup repair decision diagnostic is invalid".to_string());
            }
        }
        StartupPhase::OwnerRepairStage => {
            if !matches!(event.status, StartupPhaseStatus::Completed)
                || event.duration_ms.is_some()
                || repair_fields != (false, true, false)
            {
                return Err("Startup repair stage diagnostic is invalid".to_string());
            }
        }
        StartupPhase::OwnerRepairReport => {
            let Some(report) = event.repair_report.as_ref() else {
                return Err("Startup repair report diagnostic is missing".to_string());
            };
            if repair_fields != (false, false, true)
                || event.duration_ms != Some(report.duration_ms)
                || !repair_status_matches(event.status, report.status)
            {
                return Err("Startup repair report diagnostic is invalid".to_string());
            }
            validate_repair_report(report)?;
        }
        _ if repair_fields != (false, false, false) => {
            return Err("Startup repair fields are not valid for this phase".to_string())
        }
        _ => {}
    }
    Ok(())
}

fn repair_status_matches(status: StartupPhaseStatus, repair_status: StartupRepairStatus) -> bool {
    matches!(
        (status, repair_status),
        (
            StartupPhaseStatus::Completed,
            StartupRepairStatus::Completed
        ) | (StartupPhaseStatus::Failed, StartupRepairStatus::Failed)
            | (
                StartupPhaseStatus::Cancelled,
                StartupRepairStatus::Cancelled
            )
    )
}

fn validate_repair_report(report: &StartupRepairReport) -> Result<(), String> {
    validate_diagnostic_time("repairReport.durationMs", report.duration_ms)?;
    validate_diagnostic_time("repairReport.unattributedMs", report.unattributed_ms)?;
    if report.metrics.len() != StartupRepairMetricOperation::ALL.len() {
        return Err("Startup repair report metric count is invalid".to_string());
    }
    let mut operations = std::collections::BTreeSet::new();
    let mut exclusive_total = report.unattributed_ms;
    for metric in &report.metrics {
        if !operations.insert(metric.operation) {
            return Err("Startup repair report has duplicate metrics".to_string());
        }
        if metric.calls > MAX_REPAIR_COUNT {
            return Err("Startup repair report metric calls are out of range".to_string());
        }
        validate_diagnostic_time("repairReport.metric.totalMs", metric.total_ms)?;
        validate_diagnostic_time("repairReport.metric.maxMs", metric.max_ms)?;
        if metric.max_ms > metric.total_ms
            || (metric.calls == 0 && (metric.total_ms != 0 || metric.max_ms != 0))
        {
            return Err("Startup repair report metric timing is invalid".to_string());
        }
        if metric.operation != StartupRepairMetricOperation::FilesystemEnumeration {
            exclusive_total = exclusive_total
                .checked_add(metric.total_ms)
                .ok_or_else(|| "Startup repair report timing overflowed".to_string())?;
        }
    }
    if operations.len() != StartupRepairMetricOperation::ALL.len()
        || !StartupRepairMetricOperation::ALL
            .into_iter()
            .all(|operation| operations.contains(&operation))
    {
        return Err("Startup repair report metrics are incomplete".to_string());
    }
    if exclusive_total != report.duration_ms {
        return Err("Startup repair report timings do not match duration".to_string());
    }
    for count in [
        report.counters.identity_rows,
        report.counters.fact_rows,
        report.counters.paths_checked,
        report.counters.inventory_submitted,
        report.counters.inventory_applied,
        report.counters.facts_submitted,
        report.counters.facts_applied,
        report.counters.reference_sets_submitted,
        report.counters.reference_sources_replaced,
    ] {
        if count > MAX_REPAIR_COUNT {
            return Err("Startup repair report counters are out of range".to_string());
        }
    }
    Ok(())
}

pub fn is_repair(phase: StartupPhase) -> bool {
    matches!(
        phase,
        StartupPhase::OwnerRepairDecision
            | StartupPhase::OwnerRepairStage
            | StartupPhase::OwnerRepairReport
    )
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
    use super::{validate_diagnostic, StartupDiagnosticEvent, StartupState};
    use std::time::Instant;

    fn repair_decision() -> serde_json::Value {
        serde_json::json!({
            "launchId":"a0", "phase":"owner-repair-decision", "status":"completed",
            "elapsedMs":1, "durationMs":null, "cacheAction":null,
            "repairDecision": {
                "decision":"incremental-catch-up", "scope":"owner", "forcedRefresh":false,
                "snapshot":"compatible", "savedFingerprint":"supported", "currentFingerprint":"supported",
                "countComparison":"equal", "timestampComparison":"equal", "fingerprintCurrent":true
            }
        })
    }

    #[test]
    fn diagnostic_extension_preserves_legacy_payloads_and_rejects_free_form_error_labels() {
        let mut payload = serde_json::json!({
            "launchId": "a0", "phase": "owner-visibility", "status": "failed",
            "elapsedMs": 10, "durationMs": 10, "cacheAction": null
        });
        let event: StartupDiagnosticEvent = serde_json::from_value(payload.clone()).unwrap();
        validate_diagnostic(&event).unwrap();

        assert!(event.database_role.is_none());
        payload["databaseRole"] = serde_json::json!("ambit");
        payload["failureKind"] = serde_json::json!("database-busy");
        payload["attempt"] = serde_json::json!(1);
        let event: StartupDiagnosticEvent = serde_json::from_value(payload.clone()).unwrap();
        validate_diagnostic(&event).unwrap();
        assert_eq!(serde_json::to_value(event).unwrap(), payload);
        payload["failureKind"] = serde_json::json!("private database path or SQL");
        assert!(serde_json::from_value::<StartupDiagnosticEvent>(payload).is_err());

        for (field, value) in [
            ("message", serde_json::json!("private exception")),
            ("owner", serde_json::json!("private identity")),
            ("path", serde_json::json!("private path")),
            ("sql", serde_json::json!("private parameter")),
        ] {
            let mut unknown = serde_json::json!({
                "launchId": "a0", "phase": "owner-visibility", "status": "failed",
                "elapsedMs": 10, "durationMs": 10, "cacheAction": null
            });
            unknown[field] = value;
            assert!(serde_json::from_value::<StartupDiagnosticEvent>(unknown).is_err());
        }
    }

    #[test]
    fn repair_payloads_require_their_phase_status_and_exact_redacted_shape() {
        let payload = repair_decision();
        let event: StartupDiagnosticEvent = serde_json::from_value(payload.clone()).unwrap();
        validate_diagnostic(&event).unwrap();

        let mut skipped_fingerprint = payload.clone();
        skipped_fingerprint["repairDecision"]["fingerprintCurrent"] = serde_json::Value::Null;
        let event: StartupDiagnosticEvent = serde_json::from_value(skipped_fingerprint).unwrap();
        validate_diagnostic(&event).unwrap();

        let mut wrong_phase = payload.clone();
        wrong_phase["phase"] = serde_json::json!("owner-visibility");
        let event: StartupDiagnosticEvent = serde_json::from_value(wrong_phase).unwrap();
        assert!(validate_diagnostic(&event).is_err());

        let mut wrong_status = payload.clone();
        wrong_status["status"] = serde_json::json!("started");
        let event: StartupDiagnosticEvent = serde_json::from_value(wrong_status).unwrap();
        assert!(validate_diagnostic(&event).is_err());

        let mut wrong_duration = payload.clone();
        wrong_duration["durationMs"] = serde_json::json!(1);
        let event: StartupDiagnosticEvent = serde_json::from_value(wrong_duration).unwrap();
        assert!(validate_diagnostic(&event).is_err());

        let mut unknown = payload.clone();
        unknown["repairDecision"]["privateValue"] = serde_json::json!("not admitted");
        assert!(serde_json::from_value::<StartupDiagnosticEvent>(unknown).is_err());

        let mut missing = payload.clone();
        missing.as_object_mut().unwrap().remove("repairDecision");
        let event: StartupDiagnosticEvent = serde_json::from_value(missing).unwrap();
        assert!(validate_diagnostic(&event).is_err());

        assert!(serde_json::from_str::<StartupDiagnosticEvent>(r#"{"launchId":"a0","phase":"owner-repair-decision","status":"completed","elapsedMs":-1,"durationMs":null,"cacheAction":null}"#).is_err());
        assert!(serde_json::from_str::<StartupDiagnosticEvent>(r#"{"launchId":"a0","phase":"owner-repair-decision","status":"completed","elapsedMs":NaN,"durationMs":null,"cacheAction":null}"#).is_err());
    }

    #[test]
    fn repair_reports_cover_each_metric_once_and_are_deduplicated_across_outcomes() {
        let operations = [
            "setup",
            "identity-read",
            "identity-paths",
            "identity-matching",
            "legacy-paths",
            "inventory",
            "fact-read",
            "fact-paths",
            "fact-extraction",
            "fact-write",
            "reference-write",
            "batch-yield",
            "filesystem-enumeration",
            "inventory-build",
        ];
        let metrics: Vec<_> = operations
            .into_iter()
            .map(|operation| {
                serde_json::json!({
                    "operation":operation, "calls":1, "totalMs":0, "maxMs":0
                })
            })
            .collect();
        let payload = serde_json::json!({
            "launchId":"a0", "phase":"owner-repair-report", "status":"completed", "elapsedMs":10,
            "durationMs":0, "cacheAction":null,
            "repairReport":{"status":"completed", "durationMs":0, "unattributedMs":0, "metrics":metrics,
                "counters":{"identityRows":0,"factRows":0,"pathsChecked":0,"inventorySubmitted":0,
                    "inventoryApplied":0,"factsSubmitted":0,"factsApplied":0,"referenceSetsSubmitted":0,
                    "referenceSourcesReplaced":0}}
        });
        let event: StartupDiagnosticEvent = serde_json::from_value(payload.clone()).unwrap();
        validate_diagnostic(&event).unwrap();

        let mut missing = payload.clone();
        missing["repairReport"]["metrics"]
            .as_array_mut()
            .unwrap()
            .pop();
        let event: StartupDiagnosticEvent = serde_json::from_value(missing).unwrap();
        assert!(validate_diagnostic(&event).is_err());

        let mut duplicate = payload.clone();
        duplicate["repairReport"]["metrics"].as_array_mut().unwrap()[1]["operation"] =
            serde_json::json!("setup");
        let event: StartupDiagnosticEvent = serde_json::from_value(duplicate).unwrap();
        assert!(validate_diagnostic(&event).is_err());

        let mut overflow = payload.clone();
        overflow["repairReport"]["counters"]["identityRows"] = serde_json::json!(1_000_000_001u64);
        let event: StartupDiagnosticEvent = serde_json::from_value(overflow).unwrap();
        assert!(validate_diagnostic(&event).is_err());

        let state = StartupState::new(Instant::now());
        state.record_diagnostic(&event_from(&payload)).unwrap();
        let mut failed = payload;
        failed["status"] = serde_json::json!("failed");
        failed["repairReport"]["status"] = serde_json::json!("failed");
        assert!(state.record_diagnostic(&event_from(&failed)).is_err());

        let mut stage = repair_decision();
        stage["phase"] = serde_json::json!("owner-repair-stage");
        stage.as_object_mut().unwrap().remove("repairDecision");
        stage["repairStage"] = serde_json::json!("setup");
        state.record_diagnostic(&event_from(&stage)).unwrap();
        assert!(state.record_diagnostic(&event_from(&stage)).is_err());
        stage["repairStage"] = serde_json::json!("identity");
        state.record_diagnostic(&event_from(&stage)).unwrap();
    }

    fn event_from(value: &serde_json::Value) -> StartupDiagnosticEvent {
        serde_json::from_value(value.clone()).unwrap()
    }

    #[test]
    fn ordinary_event_limit_does_not_suppress_first_ready_or_failure() {
        let state = StartupState::new(Instant::now());
        let mut event: StartupDiagnosticEvent = serde_json::from_value(serde_json::json!({
            "launchId":"a0", "phase":"collections", "status":"completed", "elapsedMs":1, "durationMs":1, "cacheAction":null
        })).unwrap();
        for _ in 0..super::MAX_EVENTS_PER_LAUNCH {
            state.record_diagnostic(&event).unwrap();
        }
        assert!(state.record_diagnostic(&event).is_err());
        event.phase = super::StartupPhase::Ready;
        state.record_diagnostic(&event).unwrap();
        assert!(state.record_diagnostic(&event).is_err());
        event.phase = super::StartupPhase::StartupFailure;
        event.status = super::StartupPhaseStatus::Failed;
        state.record_diagnostic(&event).unwrap();
    }

    #[test]
    fn unknown_sensitive_fields_are_rejected_before_diagnostics_are_recorded() {
        for (field, value) in [
            ("message", serde_json::json!("private exception")),
            ("owner", serde_json::json!("private identity")),
            ("path", serde_json::json!("private path")),
            ("sql", serde_json::json!("private parameter")),
        ] {
            let mut payload = serde_json::json!({
                "launchId":"a0", "phase":"startup-failure", "status":"failed", "elapsedMs":1,
                "durationMs":null, "cacheAction":null, "failureKind":"script-load"
            });
            payload[field] = value;
            assert!(serde_json::from_value::<StartupDiagnosticEvent>(payload).is_err());
        }
    }

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
