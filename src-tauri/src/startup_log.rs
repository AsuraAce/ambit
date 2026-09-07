//! Bounded, value-redacted startup evidence, separate from rotating application logs.
use crate::startup::{StartupDiagnosticEvent, StartupPhase};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

const FILE_LIMIT: usize = 256 * 1024;
const TERMINAL_RESERVE: usize = 32 * 1024;
const REPAIR_RESERVE: usize = 8 * 1024;
const RETAIN_LAUNCHES: usize = 20;
// StartupState admits at most 256 ordinary + 8*4 reserved + 7 repair events.
// Even a completely blocked writer cannot let ordinary events consume reserves.
const RENDERER_QUEUE_LIMIT: usize = 320;
static ACTIVE: OnceLock<Arc<StartupJournal>> = OnceLock::new();
const OBSERVATION_TIMES: [u64; 4] = [15_000, 30_000, 60_000, 120_000];
const WEBVIEW_OBSERVATIONS: &[&str] = &[
    "registered",
    "registration-unavailable",
    "browser-process-exited",
    "render-process-exited",
    "render-process-unresponsive",
    "frame-render-process-exited",
    "utility-process-exited",
    "sandbox-helper-process-exited",
    "gpu-process-exited",
    "ppapi-plugin-process-exited",
    "ppapi-broker-process-exited",
    "unknown-process-exited",
    "failure-kind-unavailable",
    "handler-removed",
    "handler-removal-unavailable",
    "page-loading",
    "page-loaded",
];
const LIFECYCLE_OBSERVATIONS: &[&str] = &[
    "close-requested",
    "settings-drain-started",
    "settings-drain-completed",
    "settings-drain-failed",
    "settings-flush-started",
    "settings-flush-completed",
    "settings-flush-failed",
    "exit-invoked",
    "exit-failed",
    "native-close-requested",
    "native-exit-requested",
    "native-window-destroyed",
    "native-exit",
];
const OBSERVATION_COUNT: usize = WEBVIEW_OBSERVATIONS.len() + LIFECYCLE_OBSERVATIONS.len();

pub struct StartupJournal {
    pub launch_id: String,
    started: Instant,
    inner: Mutex<JournalInner>,
    renderer_pending: Mutex<Vec<PendingRendererEvent>>,
    frontend_entry_received: AtomicBool,
    last_heartbeat_ms: AtomicU64,
    observer_started: AtomicBool,
    observer_ended: AtomicBool,
    observer_thread: OnceLock<std::thread::Thread>,
    webview_pending: AtomicU64,
    webview_first_ms: [AtomicU64; OBSERVATION_COUNT],
    webview_exit_codes: [AtomicU64; OBSERVATION_COUNT],
}

struct PendingRendererEvent {
    event: StartupDiagnosticEvent,
    receipt_ms: u64,
}

#[derive(Default)]
struct JournalInner {
    file: Option<File>,
    bytes: usize,
    repair_bytes: usize,
    milestones: BTreeMap<String, (u64, Option<u64>)>,
    slowest: BTreeMap<String, u64>,
    ordinary_events: usize,
    terminal_events: std::collections::BTreeSet<String>,
    repair_events: std::collections::BTreeSet<String>,
    ready: bool,
    failed: bool,
    ended: bool,
    last_renderer_milestone: Option<String>,
    last_repair_stage: Option<String>,
    outstanding_phases: BTreeMap<String, u16>,
    observation_times: std::collections::BTreeSet<u64>,
    webview_observations: std::collections::BTreeSet<&'static str>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum JournalRecordKind {
    Ordinary,
    Repair,
    Terminal,
}

pub fn install(started: Instant, identifier: &str) -> Arc<StartupJournal> {
    let directory =
        dirs::data_local_dir().map(|root| root.join(identifier).join("logs").join("startup"));
    let journal = Arc::new(StartupJournal::new(started, directory.as_deref()));
    let _ = ACTIVE.set(journal.clone());
    journal.native("native-boot", "started", None);
    journal
}

// Callers can supply only a fixed stage and durations, never a formatted log line.
pub fn owner_stage(stage: &str, succeeded: bool, duration_ms: u64) {
    let phase = match stage {
        "identity-normalization" => "owner-normalization",
        "cache-snapshot" => "owner-cache-snapshot",
        "cache-restore" => "owner-cache-restore",
        "commit" => "owner-commit",
        "refresh_invoke_owner_scope" => "owner-visibility-lock",
        "reconcile_invoke_board_snapshot" => "owner-board-lock",
        _ => return,
    };
    if let Some(journal) = ACTIVE.get() {
        journal.native(
            phase,
            if succeeded { "completed" } else { "failed" },
            Some(duration_ms),
        );
    }
}

impl StartupJournal {
    pub fn new(started: Instant, directory: Option<&Path>) -> Self {
        let launch_id = uuid::Uuid::new_v4().to_string();
        let file = directory.and_then(|directory| open_log(directory, &launch_id).ok());
        if directory.is_some() && file.is_none() {
            eprintln!("[Startup diagnostics] Local diagnostic storage is unavailable; startup will continue.");
        }
        Self {
            launch_id,
            started,
            inner: Mutex::new(JournalInner {
                file,
                ..Default::default()
            }),
            renderer_pending: Mutex::new(Vec::new()),
            frontend_entry_received: AtomicBool::new(false),
            last_heartbeat_ms: AtomicU64::new(u64::MAX),
            observer_started: AtomicBool::new(false),
            observer_ended: AtomicBool::new(false),
            observer_thread: OnceLock::new(),
            webview_pending: AtomicU64::new(0),
            webview_first_ms: std::array::from_fn(|_| AtomicU64::new(u64::MAX)),
            webview_exit_codes: std::array::from_fn(|_| AtomicU64::new(u64::MAX)),
        }
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.started.elapsed().as_millis().min(u64::MAX as u128) as u64
    }

    // This short queue lock is never held during storage, logging, or callbacks.
    // Only validated events from StartupState may enter this fixed-size queue.
    pub(crate) fn enqueue_renderer(
        &self,
        event: StartupDiagnosticEvent,
        receipt_ms: u64,
    ) -> Result<(), String> {
        let mut pending = self
            .renderer_pending
            .lock()
            .map_err(|_| "Startup diagnostic delivery is unavailable".to_owned())?;
        if self.observer_ended.load(Ordering::Acquire) {
            return Err("Startup diagnostic observation has ended".into());
        }
        if pending.len() >= RENDERER_QUEUE_LIMIT {
            return Err("Startup diagnostic delivery limit reached".into());
        }
        self.observe_renderer_receipt(&event);
        pending.push(PendingRendererEvent { event, receipt_ms });
        drop(pending);
        if let Some(thread) = self.observer_thread.get() {
            thread.unpark();
        }
        Ok(())
    }

    fn observe_renderer_receipt(&self, event: &StartupDiagnosticEvent) {
        if matches!(event.phase, StartupPhase::FrontendEntry)
            && matches!(event.status, crate::startup::StartupPhaseStatus::Completed)
        {
            self.frontend_entry_received.store(true, Ordering::Release);
        }
    }

    fn flush_renderer_events(&self) {
        let batch = match self.renderer_pending.lock() {
            Ok(mut pending) => std::mem::take(&mut *pending),
            Err(_) => return,
        };
        for pending in batch {
            self.renderer_at(&pending.event, pending.receipt_ms);
            let diagnostic = json!({"event":pending.event,"processElapsedMs":pending.receipt_ms});
            log::info!("[Startup] {diagnostic}");
        }
    }

    // The IPC and COM callbacks only update atomics. Disk work happens on the observer.
    pub fn heartbeat(&self, launch_id: &str) -> Result<(), String> {
        if launch_id != self.launch_id {
            return Err("Startup heartbeat launch ID does not match this process".into());
        }
        self.heartbeat_at(self.elapsed_ms());
        Ok(())
    }

    fn heartbeat_at(&self, elapsed_ms: u64) {
        if elapsed_ms <= 120_000 && !self.observer_ended.load(Ordering::Acquire) {
            self.last_heartbeat_ms.store(elapsed_ms, Ordering::Release);
        }
    }

    pub fn webview_observation(&self, kind: &'static str) {
        self.webview_failure(kind, None);
    }

    pub fn lifecycle(&self, launch_id: &str, stage: &'static str) -> Result<(), String> {
        if launch_id != self.launch_id || !LIFECYCLE_OBSERVATIONS[..9].contains(&stage) {
            return Err("Invalid startup lifecycle observation".into());
        }
        if !self.observer_ended.load(Ordering::Acquire) {
            self.webview_observation(stage);
        }
        Ok(())
    }

    // First observation wins, including unavailable exit codes. Publish the payload
    // before the pending bit so the worker cannot pair a timestamp with a later code.
    pub fn webview_failure(&self, kind: &'static str, exit_code: Option<i32>) {
        if let Some(index) = WEBVIEW_OBSERVATIONS
            .iter()
            .chain(LIFECYCLE_OBSERVATIONS.iter())
            .position(|candidate| *candidate == kind)
        {
            if self.webview_first_ms[index]
                .compare_exchange(
                    u64::MAX,
                    self.elapsed_ms(),
                    Ordering::AcqRel,
                    Ordering::Acquire,
                )
                .is_ok()
            {
                self.webview_exit_codes[index].store(
                    exit_code.map(|code| code as u32 as u64).unwrap_or(u64::MAX),
                    Ordering::Relaxed,
                );
                self.webview_pending.fetch_or(1 << index, Ordering::Release);
                if let Some(thread) = self.observer_thread.get() {
                    thread.unpark();
                }
            }
        }
    }

    fn flush_webview_observations(&self) {
        let pending = self.webview_pending.swap(0, Ordering::AcqRel);
        if pending == 0 {
            return;
        }
        for (index, kind) in WEBVIEW_OBSERVATIONS
            .iter()
            .chain(LIFECYCLE_OBSERVATIONS.iter())
            .enumerate()
        {
            if pending & (1 << index) == 0 {
                continue;
            }
            let callback_ms = self.webview_first_ms[index].load(Ordering::Acquire);
            if matches!(*kind, "page-loading" | "page-loaded") {
                self.record(
                    kind,
                    "completed",
                    None,
                    None,
                    json!({"phase":kind,"status":"completed","durationMs":null,
                        "observerElapsedMs":self.elapsed_ms()}),
                    JournalRecordKind::Terminal,
                    Some(callback_ms),
                );
                continue;
            }
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            if inner.webview_observations.insert(kind) {
                let lifecycle = LIFECYCLE_OBSERVATIONS.contains(kind);
                let encoded_exit = self.webview_exit_codes[index].load(Ordering::Relaxed);
                let exit_code = (encoded_exit != u64::MAX).then_some(encoded_exit as u32 as i32);
                let mut record = json!({"kind":if lifecycle {"lifecycle-observation"} else {"webview-observation"},"launchId":self.launch_id,
                    "processElapsedMs":self.elapsed_ms(),"callbackElapsedMs":callback_ms,
                    "classification":kind});
                if !lifecycle {
                    record["exitCode"] = json!(exit_code);
                }
                append(&mut inner, &record, JournalRecordKind::Terminal);
            }
        }
    }

    pub fn start_observer(self: &Arc<Self>) {
        if self.observer_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let journal = self.clone();
        if std::thread::Builder::new()
            .name("startup-observer".into())
            .spawn(move || {
                let _ = journal.observer_thread.set(std::thread::current());
                let mut next = 0;
                while !journal.observer_ended.load(Ordering::Acquire) {
                    journal.flush_renderer_events();
                    journal.flush_webview_observations();
                    let now = journal.elapsed_ms();
                    while next < OBSERVATION_TIMES.len() && now >= OBSERVATION_TIMES[next] {
                        journal
                            .observe_with_clock(OBSERVATION_TIMES[next], || journal.elapsed_ms());
                        next += 1;
                    }
                    // This dedicated thread never acquires database or WebView handles.
                    let wait_ms = OBSERVATION_TIMES
                        .get(next)
                        .map(|deadline| deadline.saturating_sub(journal.elapsed_ms()))
                        .unwrap_or(3_600_000);
                    // Once the startup budget ends, only native callbacks/teardown wake this thread.
                    std::thread::park_timeout(Duration::from_millis(wait_ms));
                }
                journal.end();
            })
            .is_err()
        {
            self.observer_ended.store(true, Ordering::Release);
            eprintln!(
                "[Startup diagnostics] Native observation is unavailable; startup will continue."
            );
        }
    }

    #[cfg(test)]
    fn observe_at(&self, scheduled_ms: u64, now_ms: u64) {
        self.observe_with_clock(scheduled_ms, || now_ms);
    }

    fn observe_with_clock(&self, scheduled_ms: u64, now: impl FnOnce() -> u64) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        if inner.ready
            || inner.ended
            || !OBSERVATION_TIMES.contains(&scheduled_ms)
            || !inner.observation_times.insert(scheduled_ms)
        {
            return;
        }
        let now_ms = now();
        let last = self.last_heartbeat_ms.load(Ordering::Acquire);
        let age = (last != u64::MAX).then(|| now_ms.saturating_sub(last));
        let outstanding: Vec<_> = inner
            .outstanding_phases
            .iter()
            .take(16)
            .map(|(phase, count)| json!({"phase":phase,"count":count}))
            .collect();
        let observation = json!({"kind":"observation","launchId":self.launch_id,
            "processElapsedMs":now_ms,"scheduledMs":scheduled_ms,
            "observerDelayMs":now_ms.saturating_sub(scheduled_ms),
            "lastHeartbeatAgeMs":age,
            "responsiveness":if age.is_some_and(|age| age <= 10_000) {"recent-heartbeat"} else {"renderer-or-transport-unknown"},
            "lastRendererMilestone":inner.last_renderer_milestone,
            "lastRepairStage":inner.last_repair_stage,
            "outstandingPhases":outstanding,"outstandingPhasesTruncated":inner.outstanding_phases.len() > 16,
            "phaseEvidenceMayBeIncomplete":inner.ordinary_events >= 256});
        append(&mut inner, &observation, JournalRecordKind::Terminal);
    }

    pub fn native(&self, phase: &'static str, status: &'static str, duration_ms: Option<u64>) {
        let reserved = matches!(
            phase,
            "native-boot"
                | "native-initialization"
                | "page-loading"
                | "page-loaded"
                | "renderer-missing"
                | "startup-failure"
        );
        self.record(
            phase,
            status,
            None,
            duration_ms,
            json!({"phase":phase,"status":status,"durationMs":duration_ms}),
            if reserved {
                JournalRecordKind::Terminal
            } else {
                JournalRecordKind::Ordinary
            },
            None,
        );
    }

    #[cfg(test)]
    pub(crate) fn renderer(&self, event: &StartupDiagnosticEvent) {
        self.renderer_at(event, self.elapsed_ms());
    }

    fn renderer_at(&self, event: &StartupDiagnosticEvent, receipt_ms: u64) {
        self.observe_renderer_receipt(event);
        let phase = serde_json::to_value(event.phase).unwrap_or(Value::Null);
        let status = serde_json::to_value(event.status).unwrap_or(Value::Null);
        self.record(
            phase.as_str().unwrap_or("unknown"),
            status.as_str().unwrap_or("unknown"),
            Some(event.elapsed_ms),
            event.duration_ms,
            json!(event),
            if crate::startup::is_repair(event.phase) {
                JournalRecordKind::Repair
            } else if is_reserved(event.phase) {
                JournalRecordKind::Terminal
            } else {
                JournalRecordKind::Ordinary
            },
            Some(receipt_ms),
        );
        if let Some(report) = event.repair_report.as_ref() {
            self.log_repair_report(report);
        }
    }

    fn log_repair_report(&self, report: &crate::startup::StartupRepairReport) {
        let mut exclusive: Vec<_> = report
            .metrics
            .iter()
            .filter(|metric| {
                metric.operation
                    != crate::startup::StartupRepairMetricOperation::FilesystemEnumeration
            })
            .collect();
        exclusive.sort_by_key(|metric| std::cmp::Reverse(metric.total_ms));
        let top = exclusive
            .into_iter()
            .take(3)
            .map(|metric| {
                format!(
                    "{:?}={}/{}ms/{}calls",
                    metric.operation, metric.total_ms, metric.max_ms, metric.calls
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let enumeration = report
            .metrics
            .iter()
            .find(|metric| {
                metric.operation
                    == crate::startup::StartupRepairMetricOperation::FilesystemEnumeration
            })
            .map(|metric| {
                format!(
                    "{}/{}ms/{}calls",
                    metric.total_ms, metric.max_ms, metric.calls
                )
            })
            .unwrap_or_else(|| "not recorded".to_owned());
        log::info!("[Startup repair] status={:?} elapsed={}ms unattributed={}ms; top exclusive: {}; filesystem enumeration (nested): {}", report.status, report.duration_ms, report.unattributed_ms, top, enumeration);
    }

    fn record(
        &self,
        phase: &str,
        status: &str,
        renderer_ms: Option<u64>,
        duration_ms: Option<u64>,
        event: Value,
        record_kind: JournalRecordKind,
        native_elapsed_ms: Option<u64>,
    ) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        if inner.ready && phase == "startup-failure" {
            return;
        }
        if renderer_ms.is_some() {
            if status == "completed" {
                inner.last_renderer_milestone = Some(phase.to_owned());
            }
            if status == "started" {
                let count = inner
                    .outstanding_phases
                    .entry(phase.to_owned())
                    .or_default();
                *count = count.saturating_add(1);
            } else if let Some(count) = inner.outstanding_phases.get_mut(phase) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    inner.outstanding_phases.remove(phase);
                }
            }
        }
        let elapsed = native_elapsed_ms.unwrap_or_else(|| self.elapsed_ms());
        if record_kind == JournalRecordKind::Terminal {
            if !inner.terminal_events.insert(format!("{phase}:{status}")) {
                return;
            }
        } else if record_kind == JournalRecordKind::Repair {
            let key = if phase == "owner-repair-stage" {
                event["repairStage"]
                    .as_str()
                    .map(|stage| format!("{phase}:{stage}"))
                    .unwrap_or_else(|| phase.to_owned())
            } else {
                phase.to_owned()
            };
            if !inner.repair_events.insert(key) {
                return;
            }
            if phase == "owner-repair-stage" && status == "completed" {
                inner.last_repair_stage = event["repairStage"].as_str().map(str::to_owned);
            }
        } else {
            if inner.ordinary_events >= 256 {
                return;
            }
            inner.ordinary_events += 1;
        }
        if status == "completed" {
            inner
                .milestones
                .entry(phase.to_owned())
                .or_insert((elapsed, renderer_ms));
        }
        if let Some(duration) = duration_ms.filter(|_| {
            !inner.ready && record_kind != JournalRecordKind::Repair && phase != "renderer-stall"
        }) {
            inner
                .slowest
                .entry(phase.to_owned())
                .and_modify(|old| *old = (*old).max(duration))
                .or_insert(duration);
        }
        append(
            &mut inner,
            &json!({"kind":"event","launchId":self.launch_id,"processElapsedMs":elapsed,"clock":if renderer_ms.is_some() {"native-receipt"} else {"native"},"event":event}),
            record_kind,
        );
        if phase == "ready" && status == "completed" && !inner.ready {
            inner.ready = true;
            let outcome = if inner.failed { "failed" } else { "ready" };
            self.summary(&mut inner, outcome);
        }
        if phase == "startup-failure" && !inner.failed {
            inner.failed = true;
            self.summary(&mut inner, "failed");
        }
    }

    pub fn missing_renderer(&self) {
        // Receipt is known before persistence; a delayed writer is not a missing renderer.
        if !self.frontend_entry_received.load(Ordering::Acquire) {
            self.native("renderer-missing", "not-recorded", None);
        }
    }

    // Exit must never wait for a diagnostic disk flush. The observer may be
    // terminated before its final write; missing tail evidence remains unknown.
    pub fn request_end(&self) {
        self.observer_ended.store(true, Ordering::Release);
        if let Some(thread) = self.observer_thread.get() {
            thread.unpark();
        }
    }

    fn end(&self) {
        self.request_end();
        self.flush_renderer_events();
        self.flush_webview_observations();
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        if inner.ended {
            return;
        }
        inner.ended = true;
        let outcome = if inner.failed {
            "failed"
        } else if inner.ready {
            "ready"
        } else {
            "interrupted"
        };
        self.summary(&mut inner, outcome);
    }

    fn summary(&self, inner: &mut JournalInner, outcome: &str) {
        let milestones = [
            "native-initialization",
            "page-loading",
            "page-loaded",
            "frontend-entry",
            "react-mount",
            "splash",
            "first-page",
            "ready",
            "invoke-catch-up",
        ]
        .map(|phase| {
            let value = inner
                .milestones
                .get(phase)
                .map(|(native, renderer)| json!({"nativeMs":native,"rendererMs":renderer}))
                .unwrap_or(json!("not recorded"));
            (phase.to_owned(), value)
        })
        .into_iter()
        .collect::<BTreeMap<_, _>>();
        let mut slowest: Vec<_> = inner
            .slowest
            .iter()
            .map(|(phase, ms)| json!({"phase":phase,"durationMs":ms}))
            .collect();
        slowest.sort_by_key(|value| std::cmp::Reverse(value["durationMs"].as_u64().unwrap_or(0)));
        slowest.truncate(5);
        let repair = json!({"records":inner.repair_events.len(),"lastStage":inner.last_repair_stage,
            "boundary":"repair reports are bounded evidence; report aggregates and nested filesystem enumeration are excluded from work ranking"});
        let summary = json!({"kind":"summary","launchId":self.launch_id,"outcome":outcome,"processElapsedMs":self.elapsed_ms(),"milestones":milestones,"slowestPhases":slowest,"repair":repair,"boundary":"native boot excludes compilation; renderer events use native receipt and renderer elapsed clocks; splash is dismissal start, not painted pixels; catch-up is separate; phases can overlap; renderer stall is observation, not work"});
        append(inner, &summary, JournalRecordKind::Terminal);
        let timing = |phase: &str| {
            inner
                .milestones
                .get(phase)
                .map(|(ms, _)| format!("{ms}ms"))
                .unwrap_or_else(|| "not recorded".to_owned())
        };
        let phases = inner
            .slowest
            .iter()
            .fold(Vec::new(), |mut values, (phase, duration)| {
                values.push((*duration, phase));
                values
            });
        let mut phases = phases;
        phases.sort_by_key(|(duration, _)| std::cmp::Reverse(*duration));
        let phases = phases
            .into_iter()
            .take(5)
            .map(|(duration, phase)| format!("{phase}={duration}ms"))
            .collect::<Vec<_>>()
            .join(", ");
        log::info!("[Startup summary] launch={} outcome={} splash={} first-page={} ready={} catch-up={}; slowest: {}; repair records={} last-stage={}; native boot/receipt clock, excludes build; repair aggregates and nested filesystem enumeration are excluded; renderer stall is observation; phases overlap; splash begins dismissal", self.launch_id, outcome, timing("splash"), timing("first-page"), timing("ready"), timing("invoke-catch-up"), phases, inner.repair_events.len(), inner.last_repair_stage.as_deref().unwrap_or("not recorded"));
    }
}

pub fn is_reserved(phase: StartupPhase) -> bool {
    matches!(
        phase,
        StartupPhase::FrontendEntry
            | StartupPhase::ReactMount
            | StartupPhase::StartupFailure
            | StartupPhase::RendererStall
            | StartupPhase::Splash
            | StartupPhase::FirstPage
            | StartupPhase::Ready
            | StartupPhase::InvokeCatchUp
    )
}

fn append(inner: &mut JournalInner, value: &Value, record_kind: JournalRecordKind) {
    let Ok(mut bytes) = serde_json::to_vec(value) else {
        return;
    };
    bytes.push(b'\n');
    let limit = match record_kind {
        JournalRecordKind::Terminal => FILE_LIMIT,
        JournalRecordKind::Ordinary => {
            FILE_LIMIT - TERMINAL_RESERVE - REPAIR_RESERVE.saturating_sub(inner.repair_bytes)
        }
        JournalRecordKind::Repair => FILE_LIMIT - TERMINAL_RESERVE,
    };
    if inner.bytes + bytes.len() > limit
        || (record_kind == JournalRecordKind::Repair
            && inner.repair_bytes + bytes.len() > REPAIR_RESERVE)
    {
        return;
    }
    if let Some(file) = inner.file.as_mut() {
        if file.write_all(&bytes).and_then(|_| file.flush()).is_err() {
            inner.file = None;
            return;
        }
        inner.bytes += bytes.len();
        if record_kind == JournalRecordKind::Repair {
            inner.repair_bytes += bytes.len();
        }
    }
}

fn redirected(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

fn owned_name(name: &str) -> bool {
    name.strip_prefix("startup-")
        .and_then(|name| name.strip_suffix(".jsonl"))
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id))
}

fn open_log(directory: &Path, launch_id: &str) -> std::io::Result<File> {
    open_log_with_remove(directory, launch_id, |path| fs::remove_file(path))
}

fn open_log_with_remove(
    directory: &Path,
    launch_id: &str,
    mut remove_file: impl FnMut(&Path) -> std::io::Result<()>,
) -> std::io::Result<File> {
    // Fail closed on redirected ancestors; never traverse them for retention.
    for ancestor in directory.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) if redirected(&metadata) => {
                return Err(std::io::ErrorKind::PermissionDenied.into())
            }
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error),
        }
    }
    fs::create_dir_all(directory)?;
    let mut logs = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if !owned_name(&entry.file_name().to_string_lossy()) {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path())?;
        if redirected(&metadata) || !metadata.is_file() {
            continue;
        }
        logs.push((
            metadata.created().or_else(|_| metadata.modified())?,
            entry.path(),
        ));
    }
    logs.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    for (_, path) in logs.into_iter().skip(RETAIN_LAUNCHES - 1) {
        remove_file(&path)?;
    }
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(directory.join(format!("startup-{launch_id}.jsonl")))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn renderer_command_returns_while_diagnostic_storage_is_locked() {
        use tauri::Manager;
        let journal = Arc::new(StartupJournal::new(Instant::now(), None));
        let held = journal.inner.lock().unwrap();
        let worker_journal = journal.clone();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let app = tauri::test::mock_builder()
                .manage(crate::startup::StartupState::with_journal(
                    Instant::now(),
                    worker_journal.clone(),
                ))
                .build(tauri::test::mock_context(tauri::test::noop_assets()))
                .unwrap();
            started_tx.send(()).unwrap();
            let result = crate::startup::record_startup_diagnostic(
                renderer_event(&worker_journal, "collection-counts", "started"),
                app.state::<crate::startup::StartupState>(),
            );
            // Subsequent command work on the dispatch thread must remain reachable.
            let heartbeat = worker_journal.heartbeat(&worker_journal.launch_id);
            done_tx.send((result, heartbeat)).unwrap();
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let returned = done_rx.recv_timeout(Duration::from_secs(1));
        drop(held);
        worker.join().unwrap();
        let (result, heartbeat) =
            returned.expect("diagnostic dispatch must not wait for journal storage");
        assert!(result.is_ok());
        assert!(heartbeat.is_ok());
    }

    #[test]
    fn queued_renderer_preserves_receipt_order_and_drains_before_final_summary() {
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        for (status, receipt) in [("started", 11), ("completed", 22)] {
            journal
                .enqueue_renderer(
                    renderer_event(&journal, "collection-counts", status),
                    receipt,
                )
                .unwrap();
        }
        journal
            .enqueue_renderer(renderer_event(&journal, "ready", "completed"), 33)
            .unwrap();
        assert_eq!(
            journal.inner.lock().unwrap().bytes,
            0,
            "admission must do no disk work"
        );
        journal.end();
        let records = events(&directory.0);
        let receipts: Vec<_> = records
            .iter()
            .filter(|r| r["kind"] == "event")
            .map(|r| r["processElapsedMs"].as_u64().unwrap())
            .collect();
        assert_eq!(receipts, vec![11, 22, 33]);
        assert_eq!(
            records.last().unwrap()["milestones"]["ready"]["nativeMs"],
            33
        );
        assert_eq!(records.last().unwrap()["outcome"], "ready");
        assert!(journal
            .enqueue_renderer(
                renderer_event(&journal, "collection-counts", "completed"),
                44
            )
            .is_err());
        assert!(journal.renderer_pending.lock().unwrap().is_empty());
    }

    #[test]
    fn admitted_frontend_entry_is_not_missing_while_waiting_for_the_writer() {
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        journal
            .enqueue_renderer(renderer_event(&journal, "frontend-entry", "completed"), 1)
            .unwrap();
        journal.missing_renderer();
        journal.end();
        assert!(!events(&directory.0)
            .iter()
            .any(|r| r["event"]["phase"] == "renderer-missing"));
    }

    #[test]
    fn validated_queue_reserves_terminal_and_repair_records_under_saturation() {
        use tauri::Manager;
        assert!(RENDERER_QUEUE_LIMIT >= 256 + 8 * 4 + 7);
        let directory = TestLogs::new();
        let journal = Arc::new(StartupJournal::new(Instant::now(), Some(&directory.0)));
        let app = tauri::test::mock_builder()
            .manage(crate::startup::StartupState::with_journal(
                Instant::now(),
                journal.clone(),
            ))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let dispatch = |event| {
            crate::startup::record_startup_diagnostic(
                event,
                app.state::<crate::startup::StartupState>(),
            )
        };
        let mut foreign = renderer_event(&journal, "collection-counts", "completed");
        foreign.launch_id = "foreign".into();
        assert!(dispatch(foreign).is_err());
        let mut malformed = renderer_event(&journal, "collection-counts", "completed");
        malformed.elapsed_ms = u64::MAX;
        assert!(dispatch(malformed).is_err());
        assert!(journal.renderer_pending.lock().unwrap().is_empty());
        for _ in 0..256 {
            dispatch(renderer_event(&journal, "collection-counts", "completed")).unwrap();
        }
        assert!(dispatch(renderer_event(&journal, "collection-counts", "completed")).is_err());
        dispatch(repair_report_event(&journal, "completed")).unwrap();
        dispatch(renderer_event(&journal, "ready", "completed")).unwrap();
        assert!(dispatch(renderer_event(&journal, "ready", "completed")).is_err());
        assert_eq!(journal.renderer_pending.lock().unwrap().len(), 258);
        journal.end();
        let records = events(&directory.0);
        assert_eq!(
            records
                .iter()
                .filter(|r| r["event"]["phase"] == "owner-repair-report")
                .count(),
            1
        );
        assert_eq!(records.last().unwrap()["outcome"], "ready");
        assert!(journal.inner.lock().unwrap().bytes <= FILE_LIMIT);
    }

    #[test]
    fn observer_wakes_for_post_ready_renderer_events_without_storage() {
        let journal = Arc::new(StartupJournal::new(Instant::now(), None));
        journal.start_observer();
        journal
            .enqueue_renderer(renderer_event(&journal, "ready", "completed"), 1)
            .unwrap();
        let wait_for = |phase: &str| {
            let deadline = Instant::now() + Duration::from_secs(5);
            while !journal.inner.lock().unwrap().milestones.contains_key(phase) {
                assert!(Instant::now() < deadline, "observer did not drain {phase}");
                std::thread::yield_now();
            }
        };
        wait_for("ready");
        journal
            .enqueue_renderer(
                renderer_event(&journal, "collection-counts", "completed"),
                2,
            )
            .unwrap();
        wait_for("collection-counts");
        journal.request_end();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !journal.inner.lock().unwrap().ended {
            assert!(Instant::now() < deadline, "observer did not finish");
            std::thread::yield_now();
        }
        assert_eq!(
            journal.inner.lock().unwrap().milestones["collection-counts"].0,
            2
        );
    }

    #[test]
    fn exit_details_and_close_timeline_are_nonblocking_bounded_and_reserved() {
        assert!(OBSERVATION_COUNT <= u64::BITS as usize);
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        for _ in 0..1000 {
            journal.renderer(&renderer_event(&journal, "collection-counts", "completed"));
        }
        {
            let _held = journal.inner.lock().unwrap();
            assert!(journal
                .lifecycle("wrong-launch", "close-requested")
                .is_err());
            assert!(journal
                .lifecycle(&journal.launch_id, "private owner value")
                .is_err());
            assert!(journal
                .lifecycle(&journal.launch_id, "native-exit")
                .is_err());
            for _ in 0..1000 {
                journal
                    .lifecycle(&journal.launch_id, "close-requested")
                    .unwrap();
                journal.webview_failure("browser-process-exited", Some(-1073741819));
            }
            journal.webview_failure("browser-process-exited", Some(42));
            journal.webview_failure("render-process-exited", None);
        }
        journal.webview_observation("native-exit");
        journal.end();
        let records = events(&directory.0);
        let failure = records
            .iter()
            .find(|r| r["classification"] == "browser-process-exited")
            .unwrap();
        assert_eq!(failure["exitCode"], -1073741819i32);
        assert!(records
            .iter()
            .find(|r| r["classification"] == "render-process-exited")
            .unwrap()["exitCode"]
            .is_null());
        assert_eq!(
            records
                .iter()
                .filter(|r| r["classification"] == "close-requested")
                .count(),
            1
        );
        assert_eq!(
            records
                .iter()
                .find(|r| r["classification"] == "native-exit")
                .unwrap()["kind"],
            "lifecycle-observation"
        );
        assert_eq!(records.last().unwrap()["outcome"], "interrupted");
        assert!(!serde_json::to_string(&records)
            .unwrap()
            .contains("private owner"));
        assert!(journal.inner.lock().unwrap().bytes <= FILE_LIMIT);
    }
    #[test]
    fn exit_code_zero_and_signed_extremes_are_not_unavailable() {
        for code in [0, i32::MIN, i32::MAX, 259] {
            let directory = TestLogs::new();
            let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
            journal.webview_failure("browser-process-exited", Some(code));
            journal.end();
            assert_eq!(events(&directory.0)[0]["exitCode"], code);
        }
    }
    #[test]
    fn exit_callback_only_signals_even_when_diagnostic_storage_is_locked() {
        let journal = StartupJournal::new(Instant::now(), None);
        {
            let inner = journal.inner.lock().unwrap();
            journal.request_end();
            assert!(journal.observer_ended.load(Ordering::Acquire));
            assert!(
                !inner.ended,
                "the lifecycle callback must not flush or finalize storage"
            );
        }
        journal.end(); // The observer owns this step, never the native exit callback.
        assert!(journal.inner.lock().unwrap().ended);
    }
    struct TestLogs(std::path::PathBuf);
    impl TestLogs {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "ambit-startup-journal-test-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir(&path).unwrap();
            Self(fs::canonicalize(path).unwrap())
        }
    }
    impl Drop for TestLogs {
        fn drop(&mut self) {
            // Generated direct child only; do not traverse unexpected entries.
            let temp = fs::canonicalize(std::env::temp_dir()).unwrap();
            if self.0.parent() != Some(temp.as_path()) {
                return;
            }
            if fs::symlink_metadata(&self.0).is_ok_and(|meta| redirected(&meta)) {
                return;
            }
            let Ok(entries) = fs::read_dir(&self.0) else {
                return;
            };
            for entry in entries.flatten() {
                if fs::symlink_metadata(entry.path())
                    .is_ok_and(|meta| meta.is_file() && !redirected(&meta))
                {
                    let _ = fs::remove_file(entry.path());
                }
            }
            let _ = fs::remove_dir(&self.0);
        }
    }
    fn events(directory: &Path) -> Vec<Value> {
        let path = fs::read_dir(directory)
            .unwrap()
            .flatten()
            .find(|entry| owned_name(&entry.file_name().to_string_lossy()))
            .unwrap()
            .path();
        fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
    fn renderer_event(
        journal: &StartupJournal,
        phase: &str,
        status: &str,
    ) -> StartupDiagnosticEvent {
        serde_json::from_value(json!({"launchId":journal.launch_id,"phase":phase,"status":status,"elapsedMs":12,"durationMs":4,"cacheAction":null})).unwrap()
    }
    fn repair_report_event(journal: &StartupJournal, status: &str) -> StartupDiagnosticEvent {
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
                json!({
                    "operation":operation,"calls":1,"totalMs":0,"maxMs":0
                })
            })
            .collect();
        serde_json::from_value(json!({
            "launchId":journal.launch_id,"phase":"owner-repair-report","status":status,
            "elapsedMs":12,"durationMs":0,"cacheAction":null,
            "repairReport":{"status":status,"durationMs":0,"unattributedMs":0,"metrics":metrics,
                "counters":{"identityRows":0,"factRows":0,"pathsChecked":0,"inventorySubmitted":0,
                    "inventoryApplied":0,"factsSubmitted":0,"factsApplied":0,"referenceSetsSubmitted":0,
                    "referenceSourcesReplaced":0}}
        })).unwrap()
    }
    #[test]
    fn ordinary_saturation_preserves_terminal_summary_and_milestones() {
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        for _ in 0..1000 {
            journal.renderer(&renderer_event(&journal, "collection-counts", "completed"));
        }
        journal.renderer(&renderer_event(&journal, "splash", "completed"));
        journal.renderer(&renderer_event(&journal, "ready", "completed"));
        journal.end();
        let records = events(&directory.0);
        assert_eq!(
            records
                .iter()
                .filter(|event| event["event"]["phase"] == "collection-counts")
                .count(),
            256
        );
        let summary = records.last().unwrap();
        assert_eq!(summary["outcome"], "ready");
        assert_eq!(summary["milestones"]["first-page"], "not recorded");
        assert_eq!(summary["milestones"]["splash"]["rendererMs"], 12);
    }

    #[test]
    fn repair_records_have_a_separate_budget_and_do_not_displace_terminal_records() {
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        {
            let mut inner = journal.inner.lock().unwrap();
            for _ in 0..100 {
                append(
                    &mut inner,
                    &json!({"repairPadding":"x".repeat(1024)}),
                    JournalRecordKind::Repair,
                );
            }
            assert!(inner.repair_bytes <= REPAIR_RESERVE);
            assert!(inner.bytes <= REPAIR_RESERVE);
        }
        journal.end();
        assert_eq!(
            events(&directory.0).last().unwrap()["outcome"],
            "interrupted"
        );
    }

    #[test]
    fn ordinary_saturation_still_persists_one_real_repair_report_and_terminal_summary() {
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        for _ in 0..1_000 {
            journal.renderer(&renderer_event(&journal, "collection-counts", "completed"));
        }
        let report = repair_report_event(&journal, "completed");
        journal.renderer(&report);
        journal.renderer(&report);
        journal.renderer(&renderer_event(&journal, "ready", "completed"));
        journal.end();
        let records = events(&directory.0);
        assert_eq!(
            records
                .iter()
                .filter(|record| record["event"]["phase"] == "owner-repair-report")
                .count(),
            1
        );
        assert_eq!(records.last().unwrap()["outcome"], "ready");
        assert!(journal.inner.lock().unwrap().bytes <= FILE_LIMIT);
    }

    #[test]
    fn observation_records_the_last_completed_repair_stage() {
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        let stage: StartupDiagnosticEvent = serde_json::from_value(json!({
            "launchId":journal.launch_id,"phase":"owner-repair-stage","status":"completed",
            "elapsedMs":12,"durationMs":null,"cacheAction":null,"repairStage":"identity"
        }))
        .unwrap();
        journal.renderer(&stage);
        journal.observe_at(15_000, 15_000);
        assert_eq!(events(&directory.0)[1]["lastRepairStage"], "identity");
    }

    #[test]
    fn a_failure_report_survives_readiness_and_journal_deduplicates_later_outcomes() {
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        journal.renderer(&renderer_event(&journal, "ready", "completed"));
        journal.renderer(&repair_report_event(&journal, "failed"));
        journal.renderer(&repair_report_event(&journal, "cancelled"));
        let records = events(&directory.0);
        assert_eq!(
            records
                .iter()
                .filter(|record| record["event"]["phase"] == "owner-repair-report")
                .count(),
            1
        );
        assert_eq!(
            records
                .iter()
                .find(|record| record["event"]["phase"] == "owner-repair-report")
                .unwrap()["event"]["status"],
            "failed"
        );
    }
    #[test]
    fn byte_cap_reserves_final_summary() {
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        {
            let mut inner = journal.inner.lock().unwrap();
            for _ in 0..300 {
                append(
                    &mut inner,
                    &json!({"padding":"x".repeat(1024)}),
                    JournalRecordKind::Ordinary,
                );
            }
            assert!(inner.bytes <= FILE_LIMIT - TERMINAL_RESERVE - REPAIR_RESERVE);
        }
        journal.end();
        assert_eq!(
            events(&directory.0).last().unwrap()["outcome"],
            "interrupted"
        );
        assert!(journal.inner.lock().unwrap().bytes <= FILE_LIMIT);
    }
    #[test]
    fn retention_keeps_twenty_launches_and_unrelated_files() {
        let directory = TestLogs::new();
        fs::write(directory.0.join("application.log"), b"unrelated").unwrap();
        for _ in 0..24 {
            let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
            journal.end();
        }
        assert_eq!(
            fs::read_dir(&directory.0)
                .unwrap()
                .flatten()
                .filter(|entry| owned_name(&entry.file_name().to_string_lossy()))
                .count(),
            RETAIN_LAUNCHES
        );
        assert_eq!(
            fs::read(directory.0.join("application.log")).unwrap(),
            b"unrelated"
        );
    }
    #[test]
    fn retention_failure_does_not_create_an_empty_launch_file() {
        let directory = TestLogs::new();
        for _ in 0..RETAIN_LAUNCHES {
            let path = directory
                .0
                .join(format!("startup-{}.jsonl", uuid::Uuid::new_v4()));
            fs::write(&path, b"old").unwrap();
        }
        let launch_id = uuid::Uuid::new_v4().to_string();
        let new_path = directory.0.join(format!("startup-{launch_id}.jsonl"));

        assert!(open_log_with_remove(&directory.0, &launch_id, |_| {
            Err(std::io::ErrorKind::PermissionDenied.into())
        })
        .is_err());
        assert!(!new_path.exists());
    }
    #[test]
    fn failure_and_unclosed_launch_do_not_claim_readiness() {
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        journal.native("native-boot", "started", None);
        assert!(events(&directory.0)
            .iter()
            .all(|record| record["kind"] != "summary"));
        journal.renderer(&renderer_event(&journal, "startup-failure", "failed"));
        journal.end();
        assert_eq!(events(&directory.0).last().unwrap()["outcome"], "failed");
    }
    #[test]
    fn post_readiness_failure_cannot_reclassify_a_successful_launch() {
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        journal.renderer(&renderer_event(&journal, "ready", "completed"));
        journal.renderer(&renderer_event(&journal, "startup-failure", "failed"));
        journal.end();

        let records = events(&directory.0);
        assert!(records
            .iter()
            .filter(|record| record["kind"] == "summary")
            .all(|record| record["outcome"] == "ready"));
        assert!(records
            .iter()
            .all(|record| { record["event"]["phase"] != "startup-failure" }));
    }
    #[test]
    fn unwritable_storage_falls_back_without_blocking_launch_records() {
        let directory = TestLogs::new();
        let regular_file = directory.0.join("not-a-directory");
        fs::write(&regular_file, b"do not replace").unwrap();
        let journal = StartupJournal::new(Instant::now(), Some(&regular_file));
        journal.native("native-boot", "started", None);
        journal.end();
        assert!(journal.inner.lock().unwrap().file.is_none());
        assert_eq!(fs::read(regular_file).unwrap(), b"do not replace");
    }
    #[test]
    fn unavailable_storage_does_not_prevent_summary_and_missing_is_not_zero() {
        let journal = StartupJournal::new(Instant::now(), None);
        journal.native("native-boot", "started", None);
        journal.missing_renderer();
        journal.end();
        let inner = journal.inner.lock().unwrap();
        assert!(inner.ended);
        assert!(!inner.ready);
        assert!(!inner.milestones.contains_key("ready"));
        assert!(inner
            .terminal_events
            .contains("renderer-missing:not-recorded"));
    }
    #[test]
    fn retention_names_do_not_match_other_logs_or_paths() {
        assert!(owned_name(
            "startup-12345678-1234-4234-8234-123456789abc.jsonl"
        ));
        for name in [
            "application.log",
            "startup-private.jsonl",
            "../startup-12345678-1234-4234-8234-123456789abc.jsonl",
        ] {
            assert!(!owned_name(name));
        }
    }

    #[test]
    fn snapshots_distinguish_slow_work_silence_and_recovery_without_claiming_crash() {
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        journal.renderer(&renderer_event(&journal, "react-mount", "completed"));
        journal.renderer(&renderer_event(&journal, "maintenance-counts", "started"));
        journal.heartbeat_at(14_000);
        journal.observe_at(15_000, 15_125);
        journal.observe_at(30_000, 31_000);
        journal.heartbeat_at(59_000);
        journal.observe_at(60_000, 60_000);
        let records = events(&directory.0);
        let observations: Vec<_> = records
            .iter()
            .filter(|r| r["kind"] == "observation")
            .collect();
        assert_eq!(observations.len(), 3);
        assert_eq!(observations[0]["responsiveness"], "recent-heartbeat");
        assert_eq!(observations[0]["observerDelayMs"], 125);
        assert_eq!(observations[0]["lastRendererMilestone"], "react-mount");
        assert_eq!(
            observations[0]["outstandingPhases"][0]["phase"],
            "maintenance-counts"
        );
        assert_eq!(
            observations[1]["responsiveness"],
            "renderer-or-transport-unknown"
        );
        assert_eq!(observations[2]["responsiveness"], "recent-heartbeat");
        assert!(records.iter().all(|r| r["kind"] != "summary"));
    }

    #[test]
    fn heartbeat_is_nonblocking_and_does_not_consume_event_capacity() {
        let journal = StartupJournal::new(Instant::now(), None);
        let inner = journal.inner.lock().unwrap();
        for time in 0..1_000 {
            journal.heartbeat_at(time);
        }
        journal.webview_observation("render-process-exited");
        assert_eq!(inner.ordinary_events, 0);
        drop(inner);
        assert_eq!(journal.last_heartbeat_ms.load(Ordering::Relaxed), 999);
    }

    #[test]
    fn heartbeat_rejects_other_launches_and_ignores_expired_or_ended_receipts() {
        let journal = StartupJournal::new(Instant::now(), None);
        assert!(journal.heartbeat("another-launch").is_err());
        assert_eq!(journal.last_heartbeat_ms.load(Ordering::Relaxed), u64::MAX);
        assert!(journal.heartbeat(&journal.launch_id).is_ok());
        journal.heartbeat_at(120_000);
        journal.heartbeat_at(120_001);
        assert_eq!(journal.last_heartbeat_ms.load(Ordering::Relaxed), 120_000);
        journal.end();
        journal.heartbeat_at(120_000);
        journal.observe_at(120_000, 120_000);
        assert!(journal.inner.lock().unwrap().observation_times.is_empty());
    }

    #[test]
    fn missing_heartbeat_is_unknown_and_completed_work_leaves_outstanding_set() {
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        journal.renderer(&renderer_event(&journal, "collection-counts", "started"));
        journal.renderer(&renderer_event(&journal, "collection-counts", "started"));
        journal.renderer(&renderer_event(&journal, "collection-counts", "completed"));
        journal.observe_at(15_000, 15_000);
        journal.renderer(&renderer_event(&journal, "collection-counts", "cancelled"));
        journal.observe_at(30_000, 30_000);
        let records = events(&directory.0);
        let snapshots: Vec<_> = records
            .iter()
            .filter(|r| r["kind"] == "observation")
            .collect();
        assert!(snapshots[0]["lastHeartbeatAgeMs"].is_null());
        assert_eq!(
            snapshots[0]["responsiveness"],
            "renderer-or-transport-unknown"
        );
        assert_eq!(snapshots[0]["outstandingPhases"][0]["count"], 1);
        assert_eq!(snapshots[1]["outstandingPhases"], json!([]));
    }

    #[test]
    fn bounded_observations_and_webview_events_preserve_terminal_records() {
        let directory = TestLogs::new();
        let journal = StartupJournal::new(Instant::now(), Some(&directory.0));
        for _ in 0..1_000 {
            journal.renderer(&renderer_event(&journal, "collection-counts", "started"));
        }
        journal.observe_at(15_000, 15_000);
        journal.observe_at(15_000, 16_000);
        journal.observe_at(16_000, 16_000);
        journal.webview_observation("render-process-exited");
        journal.webview_observation("render-process-exited");
        journal.webview_observation("a private path or raw error");
        journal.flush_webview_observations();
        journal.renderer(&renderer_event(&journal, "ready", "completed"));
        journal.observe_at(30_000, 30_000);
        journal.webview_observation("gpu-process-exited");
        journal.flush_webview_observations();
        journal.end();
        let records = events(&directory.0);
        assert_eq!(
            records
                .iter()
                .filter(|r| r["kind"] == "observation")
                .count(),
            1
        );
        assert_eq!(
            records
                .iter()
                .filter(|r| r["kind"] == "webview-observation")
                .count(),
            2
        );
        assert_eq!(records.last().unwrap()["outcome"], "ready");
        assert!(!serde_json::to_string(&records)
            .unwrap()
            .contains("private path"));
        assert!(journal.inner.lock().unwrap().bytes <= FILE_LIMIT);
    }
}
