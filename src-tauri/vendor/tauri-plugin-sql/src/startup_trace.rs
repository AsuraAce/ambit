// Ambit downstream, feature-gated startup evidence. No logging or database policy.
use serde::Serialize;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

const DETAIL_LIMIT: usize = 32;
const COARSE_LIMIT: usize = 128;
const WINDOW: Duration = Duration::from_secs(180);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Operation {
    Load,
    Select,
    Execute,
    Close,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    Main,
    Other,
    All,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Label {
    Collection,
    Maintenance,
    Gallery,
    GlobalGallery,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Stage {
    RegistryWait,
    Bind,
    Acquire,
    Fetch,
    Decode,
    Connect,
    MigrationMutex,
    Migrate,
    RegistryWrite,
    Work,
    Finished,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    Pending,
    Completed,
    Failed,
    Interrupted,
    Incomplete,
}

#[derive(Clone, Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
    pub registry_wait_ms: Option<f64>,
    pub bind_ms: Option<f64>,
    pub acquire_ms: Option<f64>,
    pub fetch_ms: Option<f64>,
    pub decode_ms: Option<f64>,
    pub connect_ms: Option<f64>,
    pub migration_mutex_ms: Option<f64>,
    pub migrate_ms: Option<f64>,
    pub registry_write_ms: Option<f64>,
}
impl Timings {
    fn add(&mut self, stage: Stage, ms: f64) {
        let field = match stage {
            Stage::RegistryWait => &mut self.registry_wait_ms,
            Stage::Bind => &mut self.bind_ms,
            Stage::Acquire => &mut self.acquire_ms,
            Stage::Fetch => &mut self.fetch_ms,
            Stage::Decode => &mut self.decode_ms,
            Stage::Connect => &mut self.connect_ms,
            Stage::MigrationMutex => &mut self.migration_mutex_ms,
            Stage::Migrate => &mut self.migrate_ms,
            Stage::RegistryWrite => &mut self.registry_write_ms,
            Stage::Work | Stage::Finished => return,
        };
        *field = Some(field.unwrap_or(0.0) + ms);
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceRecord {
    pub operation_id: u32,
    pub call_id: Option<u32>,
    pub operation: Operation,
    pub role: Role,
    pub label: Option<Label>,
    pub status: Status,
    pub started_ms: f64,
    pub elapsed_ms: f64,
    pub stage: Stage,
    pub timings: Timings,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceBatch {
    pub details: Vec<TraceRecord>,
    pub coarse: Vec<TraceRecord>,
    pub detailed_admitted: u32,
    pub coarse_admitted: u32,
    pub detailed_dropped: u32,
    pub coarse_dropped: u32,
    pub detailed_pending: u32,
    pub coarse_pending: u32,
    pub closed: bool,
}
// One monotonic admission word linearizes slot reservation with stop-admission.
// Low 32 bits identify detail call IDs; the next eight hold the coarse count.
const COARSE_SHIFT: u32 = 32;
const DETAIL_MASK: u64 = (1_u64 << DETAIL_LIMIT) - 1;
const COARSE_MASK: u64 = 255_u64 << COARSE_SHIFT;
const STOPPED: u64 = 1_u64 << 40;
const OPEN: u8 = 0;
const PUBLISHING: u8 = 1;
const COMPLETED: u8 = 2;
const SEALED: u8 = 3;

struct Slot {
    initial: std::sync::OnceLock<TraceRecord>,
    completion: std::sync::OnceLock<TraceRecord>,
    latest_stage: std::sync::atomic::AtomicU8,
    terminal: std::sync::atomic::AtomicU8,
}
impl Slot {
    fn new() -> Self {
        Self {
            initial: std::sync::OnceLock::new(),
            completion: std::sync::OnceLock::new(),
            latest_stage: std::sync::atomic::AtomicU8::new(Stage::RegistryWait as u8),
            terminal: std::sync::atomic::AtomicU8::new(OPEN),
        }
    }
    fn initialize(&self, record: TraceRecord) {
        self.latest_stage
            .store(record.stage as u8, Ordering::Relaxed);
        // Exactly one successful reservation owns this cell. Readers use get(), never wait().
        let _ = self.initial.set(record);
    }
    fn stage(&self, stage: Stage) {
        self.latest_stage.store(stage as u8, Ordering::Relaxed);
    }
    fn complete(&self, record: TraceRecord) {
        if self
            .terminal
            .compare_exchange(OPEN, PUBLISHING, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        // Only this span writes completion. OnceLock cannot wait on another initializer.
        let _ = self.completion.set(record);
        // Final observation can seal a publisher in flight; that completion stays ignored.
        let _ = self.terminal.compare_exchange(
            PUBLISHING,
            COMPLETED,
            Ordering::Release,
            Ordering::Acquire,
        );
    }
    fn seal(&self) {
        // A unique publisher can make at most two transitions. Strong CAS has no spurious
        // failure; three attempts cover every possible transition without a spinlock.
        let mut state = self.terminal.load(Ordering::Acquire);
        for _ in 0..3 {
            if state == COMPLETED || state == SEALED {
                return;
            }
            match self
                .terminal
                .compare_exchange(state, SEALED, Ordering::AcqRel, Ordering::Acquire)
            {
                Ok(_) => return,
                Err(next) => state = next,
            }
        }
    }
    fn read(&self, closed: bool, now_ms: f64) -> Option<TraceRecord> {
        if closed {
            self.seal();
        }
        if self.terminal.load(Ordering::Acquire) == COMPLETED {
            return self.completion.get().cloned();
        }
        let mut record = self.initial.get()?.clone();
        record.status = if closed {
            Status::Incomplete
        } else {
            Status::Pending
        };
        record.elapsed_ms = (now_ms - record.started_ms).max(0.0);
        record.stage = match self.latest_stage.load(Ordering::Relaxed) {
            0 => Stage::RegistryWait,
            1 => Stage::Bind,
            2 => Stage::Acquire,
            3 => Stage::Fetch,
            4 => Stage::Decode,
            5 => Stage::Connect,
            6 => Stage::MigrationMutex,
            7 => Stage::Migrate,
            8 => Stage::RegistryWrite,
            9 => Stage::Work,
            _ => Stage::Finished,
        };
        // Only the span owns accumulated timings. Pending/incomplete snapshots deliberately
        // retain None rather than racing a mutable record or claiming zero-duration work.
        Some(record)
    }
}

// Only observers access delivery state. Holding this mutex never affects query callbacks.
struct Records {
    details: [bool; DETAIL_LIMIT],
    coarse: [bool; COARSE_LIMIT],
}
pub struct Collector {
    launch_id: String,
    main_urls: Vec<String>,
    origin: Instant,
    admission: AtomicU64,
    closed: AtomicBool,
    closed_at_us: AtomicU64,
    next_id: AtomicU32,
    detailed_dropped: AtomicU32,
    coarse_dropped: AtomicU32,
    details: [Slot; DETAIL_LIMIT],
    coarse: [Slot; COARSE_LIMIT],
    records: Mutex<Records>,
}
pub(crate) struct TraceState(pub Option<Arc<Collector>>);

fn metadata(value: Option<Value>, launch_id: &str) -> Option<(u32, Label)> {
    let value = value?;
    let object = value.as_object()?;
    if object.len() != 3 || object.get("launchId")?.as_str()? != launch_id {
        return None;
    }
    let call_id = u32::try_from(object.get("callId")?.as_u64()?).ok()?;
    if !(1..=DETAIL_LIMIT as u32).contains(&call_id) {
        return None;
    }
    let label = match object.get("label")?.as_str()? {
        "collection" => Label::Collection,
        "maintenance" => Label::Maintenance,
        "gallery" => Label::Gallery,
        "global-gallery" => Label::GlobalGallery,
        _ => return None,
    };
    Some((call_id, label))
}

impl Collector {
    pub fn new(launch_id: String, main_urls: Vec<String>, origin: Instant) -> Arc<Self> {
        let valid = uuid::Uuid::parse_str(&launch_id).is_ok();
        Arc::new(Self {
            launch_id,
            main_urls,
            origin,
            admission: AtomicU64::new(if valid { 0 } else { STOPPED }),
            closed: AtomicBool::new(false),
            closed_at_us: AtomicU64::new(u64::MAX),
            next_id: AtomicU32::new(1),
            detailed_dropped: AtomicU32::new(0),
            coarse_dropped: AtomicU32::new(0),
            details: std::array::from_fn(|_| Slot::new()),
            coarse: std::array::from_fn(|_| Slot::new()),
            records: Mutex::new(Records {
                details: [false; DETAIL_LIMIT],
                coarse: [false; COARSE_LIMIT],
            }),
        })
    }
    pub fn stop_admission(&self) {
        self.admission.fetch_or(STOPPED, Ordering::AcqRel);
    }
    pub fn finish_observation(&self) {
        self.stop_admission();
        self.closed_at_us.fetch_min(
            self.origin.elapsed().min(WINDOW).as_micros() as u64,
            Ordering::Relaxed,
        );
        self.closed.store(true, Ordering::Release);
    }
    fn expired(&self) -> bool {
        if self.origin.elapsed() >= WINDOW {
            self.finish_observation();
        }
        self.closed.load(Ordering::Acquire)
    }
    fn reserve(&self, call_id: Option<u32>) -> Option<(Option<usize>, Option<usize>)> {
        let bit = call_id.map(|id| 1_u64 << (id - 1));
        let mut observed = self.admission.load(Ordering::Acquire);
        // At most 160 slot claims and one stop transition can change this word. Each
        // failed strong CAS observes one such change: a finite bound, not a spinlock.
        for _ in 0..(DETAIL_LIMIT + COARSE_LIMIT + 2) {
            if observed & STOPPED != 0 {
                return None;
            }
            let detailed = bit
                .filter(|bit| observed & bit == 0)
                .map(|_| call_id.unwrap() as usize - 1);
            let count = ((observed & COARSE_MASK) >> COARSE_SHIFT) as usize;
            let coarse = (count < COARSE_LIMIT).then_some(count);
            let next = observed | if detailed.is_some() { bit.unwrap() } else { 0 };
            let next = next
                + if coarse.is_some() {
                    1_u64 << COARSE_SHIFT
                } else {
                    0
                };
            if next == observed {
                return Some((None, None));
            }
            match self.admission.compare_exchange(
                observed,
                next,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Some((detailed, coarse)),
                Err(next) => observed = next,
            }
        }
        // Unreachable for monotonic fixed-capacity state, but diagnostics never panic.
        None
    }
    pub(crate) fn begin(
        self: &Arc<Self>,
        operation: Operation,
        db: Option<&str>,
        value: Option<Value>,
    ) -> Option<Span> {
        let started = Instant::now();
        if self.expired() {
            return None;
        }
        let role = match db {
            None => Role::All,
            Some(url) if self.main_urls.iter().any(|main| main == url) => Role::Main,
            Some(_) => Role::Other,
        };
        let requested = value.is_some();
        let detail = if operation == Operation::Select && role == Role::Main {
            metadata(value, &self.launch_id)
        } else {
            None
        };
        let (detailed, coarse) = self.reserve(detail.map(|value| value.0))?;
        if requested && detailed.is_none() {
            self.detailed_dropped.fetch_add(1, Ordering::Relaxed);
        }
        if coarse.is_none() {
            self.coarse_dropped.fetch_add(1, Ordering::Relaxed);
        }
        if detailed.is_none() && coarse.is_none() {
            return None;
        }
        let record = TraceRecord {
            operation_id: self.next_id.fetch_add(1, Ordering::Relaxed),
            call_id: detail.filter(|_| detailed.is_some()).map(|value| value.0),
            operation,
            role,
            label: detail.filter(|_| detailed.is_some()).map(|value| value.1),
            status: Status::Pending,
            started_ms: started.duration_since(self.origin).as_secs_f64() * 1000.0,
            elapsed_ms: 0.0,
            stage: if operation == Operation::Load {
                Stage::Connect
            } else {
                Stage::RegistryWait
            },
            timings: Timings::default(),
        };
        if let Some(index) = detailed {
            self.details[index].initialize(record.clone());
        }
        if let Some(index) = coarse {
            let mut initial = record.clone();
            initial.call_id = None;
            initial.label = None;
            self.coarse[index].initialize(initial);
        }
        Some(Span {
            collector: self.clone(),
            record,
            detailed,
            coarse,
            started,
            stage_started: started,
            finished: false,
        })
    }
    /// Completed records only; drained slots remain occupied for the launch lifetime.
    pub fn drain(&self) -> Option<TraceBatch> {
        self.collect(false)
    }
    /// Undrained completions plus pending records. Call finish_observation before the final snapshot.
    pub fn snapshot(&self) -> Option<TraceBatch> {
        self.collect(true)
    }
    fn collect(&self, include_pending: bool) -> Option<TraceBatch> {
        let closed = self.expired();
        let admitted = self.admission.load(Ordering::Acquire);
        let mut delivery = self.records.try_lock().ok()?;
        let now_ms = if closed {
            self.closed_at_us.load(Ordering::Relaxed) as f64 / 1000.0
        } else {
            self.origin.elapsed().as_secs_f64() * 1000.0
        };
        fn take(
            slots: &[Slot],
            indices: impl Iterator<Item = usize>,
            delivered: &mut [bool],
            closed: bool,
            include_pending: bool,
            now_ms: f64,
        ) -> (Vec<TraceRecord>, u32) {
            let mut records = Vec::new();
            let mut pending = 0;
            for index in indices {
                let record = slots[index].read(closed, now_ms);
                // A reserved slot can be paused before immutable initialization. Count that
                // as pending/unknown even at teardown, never as no admitted operation.
                if record
                    .as_ref()
                    .is_none_or(|record| record.status == Status::Pending)
                {
                    pending += 1;
                }
                if let Some(record) = record {
                    if !delivered[index] && (include_pending || record.status != Status::Pending) {
                        if record.status != Status::Pending {
                            delivered[index] = true;
                        }
                        records.push(record);
                    }
                }
            }
            (records, pending)
        }
        let coarse_admitted = ((admitted & COARSE_MASK) >> COARSE_SHIFT) as usize;
        let (detail_records, detailed_pending) = take(
            &self.details,
            (0..DETAIL_LIMIT).filter(|index| admitted & (1_u64 << index) != 0),
            &mut delivery.details,
            closed,
            include_pending,
            now_ms,
        );
        let (coarse_records, coarse_pending) = take(
            &self.coarse,
            0..coarse_admitted,
            &mut delivery.coarse,
            closed,
            include_pending,
            now_ms,
        );
        Some(TraceBatch {
            details: detail_records,
            coarse: coarse_records,
            detailed_admitted: (admitted & DETAIL_MASK).count_ones(),
            coarse_admitted: coarse_admitted as u32,
            detailed_dropped: self.detailed_dropped.load(Ordering::Relaxed),
            coarse_dropped: self.coarse_dropped.load(Ordering::Relaxed),
            detailed_pending,
            coarse_pending,
            closed,
        })
    }
}

pub(crate) struct Span {
    collector: Arc<Collector>,
    record: TraceRecord,
    detailed: Option<usize>,
    coarse: Option<usize>,
    started: Instant,
    stage_started: Instant,
    finished: bool,
}
impl Span {
    pub(crate) fn detailed(&self) -> bool {
        self.detailed.is_some()
    }
    pub(crate) fn stage(&mut self, next: Stage) {
        let now = Instant::now();
        self.record.timings.add(
            self.record.stage,
            now.duration_since(self.stage_started).as_secs_f64() * 1000.0,
        );
        self.record.stage = next;
        self.stage_started = now;
        if !self.collector.expired() {
            if let Some(index) = self.detailed {
                self.collector.details[index].stage(next);
            }
            if let Some(index) = self.coarse {
                self.collector.coarse[index].stage(next);
            }
        }
    }
    pub(crate) fn finish(&mut self, status: Status) {
        if self.finished {
            return;
        }
        let now = Instant::now();
        self.record.timings.add(
            self.record.stage,
            now.duration_since(self.stage_started).as_secs_f64() * 1000.0,
        );
        self.record.status = status;
        self.record.elapsed_ms = now.duration_since(self.started).as_secs_f64() * 1000.0;
        if status == Status::Completed {
            self.record.stage = Stage::Finished;
        }
        self.finished = true;
        if self.collector.expired() {
            return;
        }
        if let Some(index) = self.detailed {
            self.collector.details[index].complete(self.record.clone());
        }
        if let Some(index) = self.coarse {
            let mut record = self.record.clone();
            record.call_id = None;
            record.label = None;
            self.collector.coarse[index].complete(record);
        }
    }
}
impl Drop for Span {
    fn drop(&mut self) {
        if !self.finished {
            self.finish(Status::Interrupted);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Dependency unit tests do not inherit Ambit's lib-test Common Controls manifest.
    #[cfg(all(windows, target_env = "msvc"))]
    #[used]
    #[link_section = ".drectve"]
    static TEST_MANIFEST: [u8; 168] = *b" /MANIFESTDEPENDENCY:\"type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'\" ";
    fn collector() -> Arc<Collector> {
        Collector::new(
            "00000000-0000-4000-8000-000000000000".into(),
            vec!["sqlite:private.db".into()],
            Instant::now(),
        )
    }
    fn trace(call: u32) -> Option<Value> {
        Some(
            serde_json::json!({"launchId":"00000000-0000-4000-8000-000000000000","callId":call,"label":"collection"}),
        )
    }
    #[test]
    fn observer_storage_cannot_drop_concurrent_count_completions() {
        let collector = collector();
        let held = collector.records.lock().unwrap();
        let barrier = std::sync::Barrier::new(4);
        let admitted = std::thread::scope(|scope| {
            let workers: Vec<_> = (1..=4)
                .map(|id| {
                    let collector = &collector;
                    let barrier = &barrier;
                    scope.spawn(move || {
                        barrier.wait();
                        collector
                            .begin(Operation::Select, Some("sqlite:private.db"), trace(id))
                            .map(|mut span| {
                                span.stage(Stage::Acquire);
                                span.stage(Stage::Fetch);
                                span.finish(Status::Completed);
                            })
                            .is_some()
                    })
                })
                .collect();
            workers
                .into_iter()
                .map(|worker| worker.join().unwrap())
                .filter(|admitted| *admitted)
                .count()
        });
        drop(held);
        assert_eq!(
            admitted, 4,
            "observer-owned storage must never interfere with distinct count calls"
        );
        let batch = collector.drain().unwrap();
        assert_eq!(batch.details.len(), 4);
        assert_eq!(batch.coarse.len(), 4);
        assert_eq!(batch.detailed_dropped, 0);
        assert_eq!(batch.coarse_dropped, 0);
        assert!(batch
            .details
            .iter()
            .all(|record| record.status == Status::Completed && record.timings.fetch_ms.is_some()));
    }
    #[test]
    fn bounded_slots_are_not_reused_after_drain_and_metadata_is_redacted() {
        let collector = collector();
        for id in 0..200 {
            if let Some(mut span) =
                collector.begin(Operation::Select, Some("sqlite:private.db"), trace(id))
            {
                span.finish(Status::Completed);
            }
        }
        let batch = collector.drain().unwrap();
        assert_eq!(batch.details.len(), 32);
        assert_eq!(batch.coarse.len(), 128);
        assert_eq!(batch.detailed_admitted, 32);
        assert_eq!(batch.coarse_admitted, 128);
        assert!(batch.detailed_dropped > 0);
        assert!(batch.coarse_dropped > 0);
        assert!(!serde_json::to_string(&batch).unwrap().contains("private"));
        assert!(collector.drain().unwrap().details.is_empty());
    }
    #[test]
    fn cancellation_stop_and_final_observation_have_distinct_outcomes() {
        let collector = collector();
        let cancelled = collector
            .begin(Operation::Select, Some("sqlite:private.db"), trace(1))
            .unwrap();
        drop(cancelled);
        let mut admitted = collector
            .begin(Operation::Select, Some("sqlite:private.db"), trace(2))
            .unwrap();
        collector.stop_admission();
        assert!(collector
            .begin(Operation::Load, Some("other"), None)
            .is_none());
        admitted.finish(Status::Completed);
        let batch = collector.drain().unwrap();
        assert_eq!(batch.details[0].status, Status::Interrupted);
        assert_eq!(batch.details[1].status, Status::Completed);
        let collector = super::tests::collector();
        let mut pending = collector
            .begin(Operation::Select, Some("sqlite:private.db"), trace(1))
            .unwrap();
        collector.finish_observation();
        pending.finish(Status::Completed);
        assert_eq!(
            collector.snapshot().unwrap().details[0].status,
            Status::Incomplete
        );
    }
    #[test]
    fn malformed_foreign_duplicate_and_nonmain_metadata_never_enable_details() {
        let collector = collector();
        let _ = collector.begin(
            Operation::Select,
            Some("sqlite:private.db"),
            Some(serde_json::json!({"launchId":"foreign","callId":1,"label":"collection"})),
        );
        let _ = collector.begin(Operation::Select, Some("other"), trace(1));
        let _ = collector.begin(Operation::Select, Some("sqlite:private.db"), trace(1));
        let _ = collector.begin(Operation::Select, Some("sqlite:private.db"), trace(1));
        assert_eq!(collector.snapshot().unwrap().details.len(), 1);
    }

    #[test]
    fn observer_storage_never_blocks_callbacks_and_expired_admission_stays_closed() {
        let collector = collector();
        let held = collector.records.lock().unwrap();
        let mut span = collector
            .begin(Operation::Select, Some("sqlite:private.db"), trace(1))
            .unwrap();
        span.stage(Stage::Fetch);
        span.finish(Status::Completed);
        assert!(
            collector.snapshot().is_none(),
            "only competing observer reads may be unavailable"
        );
        drop(held);
        let batch = collector.snapshot().unwrap();
        assert_eq!(batch.details.len(), 1);
        assert_eq!(batch.details[0].status, Status::Completed);
        assert_eq!(batch.detailed_dropped, 0);
        assert_eq!(batch.coarse_dropped, 0);
        let expired = Collector::new(LAUNCH_FOR_EXPIRY.into(), vec![], Instant::now() - WINDOW);
        assert!(expired
            .begin(Operation::Load, Some("unrecorded"), None)
            .is_none());
        assert!(expired.snapshot().unwrap().closed);
    }
    const LAUNCH_FOR_EXPIRY: &str = "00000000-0000-4000-8000-000000000000";

    fn initial_record() -> TraceRecord {
        TraceRecord {
            operation_id: 1,
            call_id: Some(1),
            operation: Operation::Select,
            role: Role::Main,
            label: Some(Label::Collection),
            status: Status::Pending,
            started_ms: 0.0,
            elapsed_ms: 0.0,
            stage: Stage::RegistryWait,
            timings: Timings::default(),
        }
    }

    #[test]
    fn reserved_uninitialized_slots_remain_unknown_at_teardown() {
        let collector = collector();
        assert_eq!(collector.reserve(Some(1)), Some((Some(0), Some(0))));
        // A controlled pause between atomic reservation and immutable initialization.
        collector.finish_observation();
        let gap = collector.snapshot().unwrap();
        assert!(gap.closed);
        assert_eq!(gap.detailed_admitted, 1);
        assert_eq!(gap.coarse_admitted, 1);
        assert_eq!(gap.detailed_pending, 1);
        assert_eq!(gap.coarse_pending, 1);
        assert!(gap.details.is_empty() && gap.coarse.is_empty());
        assert!(collector.reserve(Some(2)).is_none());
        assert!(collector
            .begin(Operation::Load, Some("other"), None)
            .is_none());
        collector.details[0].initialize(initial_record());
        collector.coarse[0].initialize(initial_record());
        let mut completed = initial_record();
        completed.status = Status::Completed;
        collector.details[0].complete(completed.clone());
        collector.coarse[0].complete(completed);
        let later = collector.snapshot().unwrap();
        assert_eq!(later.details[0].status, Status::Incomplete);
        assert_eq!(later.coarse[0].status, Status::Incomplete);
        assert_eq!(later.detailed_pending, 0);
        assert!(
            collector.snapshot().unwrap().details.is_empty(),
            "late publication cannot rewrite incomplete evidence"
        );
    }

    #[test]
    fn teardown_seals_a_completion_publication_in_flight() {
        let collector = collector();
        let mut span = collector
            .begin(Operation::Select, Some("sqlite:private.db"), trace(1))
            .unwrap();
        let slot = &collector.details[0];
        assert_eq!(
            slot.terminal
                .compare_exchange(OPEN, PUBLISHING, Ordering::AcqRel, Ordering::Acquire),
            Ok(OPEN)
        );
        collector.finish_observation();
        assert_eq!(
            collector.snapshot().unwrap().details[0].status,
            Status::Incomplete
        );
        let mut completed = span.record.clone();
        completed.status = Status::Completed;
        assert!(slot.completion.set(completed).is_ok());
        assert_eq!(
            slot.terminal.compare_exchange(
                PUBLISHING,
                COMPLETED,
                Ordering::Release,
                Ordering::Acquire
            ),
            Err(SEALED)
        );
        span.finish(Status::Completed);
        assert!(collector.snapshot().unwrap().details.is_empty());
    }

    #[test]
    fn pending_stage_has_unknown_component_timings_until_completion() {
        let collector = collector();
        let mut span = collector
            .begin(Operation::Select, Some("sqlite:private.db"), trace(1))
            .unwrap();
        span.stage(Stage::Acquire);
        span.stage(Stage::Fetch);
        let pending = collector.snapshot().unwrap();
        assert_eq!(pending.details[0].stage, Stage::Fetch);
        assert_eq!(pending.details[0].status, Status::Pending);
        let timings = serde_json::to_value(&pending.details[0].timings).unwrap();
        assert!(timings.as_object().unwrap().values().all(Value::is_null));
        assert_eq!(collector.snapshot().unwrap().detailed_pending, 1);
        span.finish(Status::Completed);
        let complete = collector.drain().unwrap();
        assert_eq!(complete.details[0].status, Status::Completed);
        assert!(complete.details[0].timings.fetch_ms.is_some());
    }

    #[test]
    fn concurrent_capacity_claims_and_invalid_ids_preserve_bounds() {
        let collector = collector();
        let barrier = std::sync::Barrier::new(DETAIL_LIMIT);
        std::thread::scope(|scope| {
            for id in 1..=DETAIL_LIMIT as u32 {
                let collector = &collector;
                let barrier = &barrier;
                scope.spawn(move || {
                    barrier.wait();
                    let mut span = collector
                        .begin(Operation::Select, Some("sqlite:private.db"), trace(id))
                        .unwrap();
                    assert!(span.detailed());
                    span.finish(Status::Completed);
                });
            }
        });
        let batch = collector.drain().unwrap();
        assert_eq!(batch.details.len(), DETAIL_LIMIT);
        assert_eq!(batch.coarse.len(), DETAIL_LIMIT);
        assert_eq!(batch.detailed_dropped, 0);
        assert_eq!(batch.coarse_dropped, 0);
        for id in [0, 33, u32::MAX] {
            let span = collector
                .begin(Operation::Select, Some("sqlite:private.db"), trace(id))
                .unwrap();
            assert!(!span.detailed());
        }
        assert_eq!(collector.snapshot().unwrap().detailed_admitted, 32);
        collector.stop_admission();
        assert!(collector.reserve(Some(1)).is_none());
        assert!(collector.reserve(None).is_none());
    }

    #[cfg(feature = "sqlite")]
    #[test]
    fn cancelled_physical_checkout_records_interruption_and_returns_capacity() {
        use std::{
            future::Future,
            task::{Context, Poll, Waker},
        };
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            let held = pool.acquire().await.unwrap();
            let db = crate::DbPool::Sqlite(pool.clone());
            let collector = collector();
            let mut span = collector
                .begin(Operation::Select, Some("sqlite:private.db"), trace(1))
                .unwrap();
            let mut pending = Box::pin(db.select_traced("SELECT 1".into(), vec![], &mut span));
            assert!(matches!(
                pending
                    .as_mut()
                    .poll(&mut Context::from_waker(Waker::noop())),
                Poll::Pending
            ));
            drop(pending);
            drop(span);
            let record = collector.drain().unwrap().details.remove(0);
            assert_eq!(record.status, Status::Interrupted);
            assert_eq!(record.stage, Stage::Acquire);
            drop(held);
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                1
            );
            pool.close().await;
        });
    }
}
