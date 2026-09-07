//! Opt-in SQL evidence adapter. SQL callbacks never touch the journal's disk lock.
#[cfg(feature = "startup-sql-trace")]
mod enabled {
    use crate::startup::StartupSqlFrontend;
    use serde_json::{json, Value};
    use std::sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex, OnceLock,
    };
    use tauri_plugin_sql::startup_trace::Collector;

    pub const RESERVE: usize = 64 * 1024;

    fn build_id(value: Option<&str>) -> String {
        value
            .and_then(|value| uuid::Uuid::parse_str(value).ok())
            .map(|id| id.to_string())
            .unwrap_or_else(|| "not-recorded".into())
    }

    pub struct JournalTrace {
        collector: OnceLock<Arc<Collector>>,
        frontend: [OnceLock<StartupSqlFrontend>; 32],
        seen: AtomicU32,
        dropped: AtomicU32,
        stopped: AtomicBool,
        finalized: AtomicBool,
        pending: Mutex<Pending>,
    }

    struct Pending {
        native: [Option<Value>; 32],
        emitted: u32,
        header: bool,
    }

    impl Default for JournalTrace {
        fn default() -> Self {
            Self {
                collector: OnceLock::new(),
                frontend: std::array::from_fn(|_| OnceLock::new()),
                seen: AtomicU32::new(0),
                dropped: AtomicU32::new(0),
                stopped: AtomicBool::new(false),
                finalized: AtomicBool::new(false),
                pending: Mutex::new(Pending {
                    native: std::array::from_fn(|_| None),
                    emitted: 0,
                    header: false,
                }),
            }
        }
    }

    impl JournalTrace {
        pub fn install(&self, collector: Arc<Collector>) {
            let _ = self.collector.set(collector);
        }
        pub fn enabled(&self) -> bool {
            self.collector.get().is_some()
        }
        pub fn observing(&self) -> bool {
            self.enabled() && !self.finalized.load(Ordering::Acquire)
        }
        pub fn stop(&self) {
            self.stopped.store(true, Ordering::Release);
            if let Some(collector) = self.collector.get() {
                collector.stop_admission();
            }
        }
        pub fn frontend(&self, launch: &str, elapsed: u64, report: StartupSqlFrontend) {
            if !self.observing()
                || elapsed >= 180_000
                || report.launch_id != launch
                || !(1..=32).contains(&report.call_id)
                || report.duration_ms > 180_000
            {
                return;
            }
            let bit = 1 << (report.call_id - 1);
            if self.seen.fetch_or(bit, Ordering::AcqRel) & bit != 0 {
                return;
            }
            // The seen bit gives this call exactly one writer. The observer only
            // uses get(), so set() cannot contend with another initializer.
            let index = (report.call_id - 1) as usize;
            if self.frontend[index].set(report).is_err() {
                self.dropped.fetch_add(1, Ordering::Relaxed);
            }
        }

        // Called only by the existing background observer, never from SQL work.
        pub fn poll(&self, elapsed: u64, teardown: bool) -> Vec<Value> {
            let Some(collector) = self.collector.get() else {
                return Vec::new();
            };
            if self.finalized.load(Ordering::Acquire) {
                return Vec::new();
            }
            let finish = teardown || elapsed >= 180_000;
            if finish {
                collector.finish_observation();
            }
            let Some(batch) = collector.drain() else {
                return Vec::new();
            };
            let Ok(mut pending) = self.pending.lock() else {
                return Vec::new();
            };
            let mut records = Vec::new();
            if !pending.header {
                pending.header = true;
                records.push(json!({"kind":"sql-trace-header","schema":1,
                    "buildId":build_id(option_env!("AMBIT_SQL_TRACE_BUILD_ID")),
                    "pluginVersion":"2.4.0","detailLimit":32,"coarseLimit":128,"deadlineMs":180000,
                    "boundary":"acquisition includes opening/health checks; fetch includes worker scheduling, preparation, execution, locks and row transfer; conversion excludes response serialization; overlap is not causation"}));
            }
            for record in batch.coarse {
                records.push(json!({"kind":"sql-operation","operation":record}));
            }
            for record in batch.details {
                if let Some(id) = record.call_id.filter(|id| (1..=32).contains(id)) {
                    pending.native[(id - 1) as usize] = serde_json::to_value(record).ok();
                }
            }
            for (index, slot) in self.frontend.iter().enumerate() {
                let report = slot.get();
                if pending.emitted & (1 << index) != 0 {
                    continue;
                }
                let native = pending.native[index].as_ref();
                let matched = report.as_ref().zip(native).is_some_and(|(report, native)| {
                    serde_json::to_value(report.label).ok().as_ref() == native.get("label")
                        && serde_json::to_value(report.status).ok().as_ref() == native.get("status")
                });
                if !matched && !finish {
                    continue;
                }
                if report.is_none() && native.is_none() {
                    continue;
                }
                let remainder = if matched {
                    native
                        .and_then(|native| native["elapsedMs"].as_f64())
                        .zip(report.as_ref())
                        .map(|(native_ms, report)| report.duration_ms as f64 - native_ms)
                } else {
                    None
                };
                records.push(
                    json!({"kind":"sql-count","callId":index+1,"matched":matched,
                    "frontend":report,"native":native,
                    "unattributedDispatchResponseMs":remainder,
                    "residualUsable":remainder.is_some_and(|value| value >= 0.0)}),
                );
                pending.emitted |= 1 << index;
            }
            let all_settled = batch.detailed_pending == 0
                && batch.coarse_pending == 0
                && pending.emitted.count_ones() == batch.detailed_admitted;
            if finish || (self.stopped.load(Ordering::Acquire) && all_settled) {
                collector.finish_observation();
                self.finalized.store(true, Ordering::Release);
                records.push(json!({"kind":"sql-trace-summary",
                    "status":if teardown {"teardown"} else if elapsed >= 180000 {"deadline"} else {"settled"},
                    "detailedAdmitted":batch.detailed_admitted,"coarseAdmitted":batch.coarse_admitted,
                    "detailedDropped":batch.detailed_dropped,"coarseDropped":batch.coarse_dropped,
                    "frontendDropped":self.dropped.load(Ordering::Relaxed),
                    "detailedPending":batch.detailed_pending,"coarsePending":batch.coarse_pending,
                    "matchedOrReported":pending.emitted.count_ones(),"missingEvidenceIsUnknown":true}));
            }
            records
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::startup::{StartupSqlLabel, StartupSqlStatus};
        const LAUNCH: &str = "00000000-0000-4000-8000-000000000001";
        fn trace() -> JournalTrace {
            let trace = JournalTrace::default();
            trace.install(Collector::new(
                LAUNCH.into(),
                vec![],
                std::time::Instant::now(),
            ));
            trace
        }
        fn report(call_id: u32) -> StartupSqlFrontend {
            StartupSqlFrontend {
                launch_id: LAUNCH.into(),
                call_id,
                label: StartupSqlLabel::Gallery,
                duration_ms: 100,
                status: StartupSqlStatus::Completed,
            }
        }
        #[test]
        fn compiled_build_metadata_accepts_only_random_identifier_shape() {
            assert_eq!(build_id(Some("C:/private/owner")), "not-recorded");
            assert_eq!(build_id(None), "not-recorded");
            assert_eq!(build_id(Some(LAUNCH)), LAUNCH);
        }
        #[test]
        fn incomplete_and_inconsistent_native_reports_never_estimate_dispatch_time() {
            for status in ["incomplete", "interrupted", "failed"] {
                let trace = trace();
                trace.frontend(LAUNCH, 20, report(1));
                trace.pending.lock().unwrap().native[0] =
                    Some(json!({"label":"gallery","status":status,"elapsedMs":50}));
                let records = trace.poll(180_000, false);
                let count = records
                    .iter()
                    .find(|record| record["kind"] == "sql-count")
                    .unwrap();
                assert_eq!(count["matched"], false);
                assert_eq!(count["residualUsable"], false);
                assert!(count["unattributedDispatchResponseMs"].is_null());
            }
        }
        #[test]
        fn matching_is_per_call_and_negative_residual_is_not_silently_clamped() {
            let trace = trace();
            trace.frontend(LAUNCH, 20, report(1));
            trace.pending.lock().unwrap().native[0] =
                Some(json!({"label":"gallery","status":"completed","elapsedMs":110}));
            let records = trace.poll(180_000, false);
            let count = records
                .iter()
                .find(|record| record["kind"] == "sql-count")
                .unwrap();
            assert_eq!(count["matched"], true);
            assert_eq!(count["residualUsable"], false);
            assert_eq!(count["unattributedDispatchResponseMs"], -10.0);
        }
        #[test]
        fn foreign_duplicate_and_saturated_frontend_evidence_is_bounded() {
            let trace = trace();
            trace.frontend("foreign", 0, report(1));
            assert_eq!(trace.seen.load(Ordering::Relaxed), 0);
            for id in 1..=33 {
                trace.frontend(LAUNCH, 0, report(id));
            }
            let mut changed = report(1);
            changed.duration_ms = 999;
            trace.frontend(LAUNCH, 0, changed);
            assert_eq!(trace.frontend[0].get().unwrap().duration_ms, 100);
            let records = trace.poll(180_000, false);
            assert_eq!(
                records
                    .iter()
                    .filter(|record| record["kind"] == "sql-count")
                    .count(),
                32
            );
            assert!(trace.poll(180_001, true).is_empty());
        }
        #[test]
        fn observer_storage_does_not_drop_frontend_evidence() {
            let trace = trace();
            let _held = trace.pending.lock().unwrap();
            trace.frontend(LAUNCH, 1, report(1));
            assert_eq!(trace.dropped.load(Ordering::Relaxed), 0);
            assert_eq!(trace.frontend[0].get().unwrap().call_id, 1);
        }

        #[test]
        fn concurrent_frontend_reports_have_independent_single_writer_slots() {
            let trace = Arc::new(trace());
            let barrier = std::sync::Barrier::new(33);
            // Observer state can be held throughout the burst without blocking
            // producers or losing their immutable reports.
            let held = trace.pending.lock().unwrap();
            std::thread::scope(|scope| {
                for id in 1..=32 {
                    let trace = &trace;
                    let barrier = &barrier;
                    scope.spawn(move || {
                        barrier.wait();
                        trace.frontend(LAUNCH, 1, report(id));
                        let mut duplicate = report(id);
                        duplicate.duration_ms = 999;
                        trace.frontend(LAUNCH, 2, duplicate);
                    });
                }
                barrier.wait();
            });
            drop(held);
            assert_eq!(trace.dropped.load(Ordering::Relaxed), 0);
            for (index, slot) in trace.frontend.iter().enumerate() {
                assert_eq!(slot.get().unwrap().call_id, index as u32 + 1);
                assert_eq!(slot.get().unwrap().duration_ms, 100);
            }
            let records = trace.poll(180_000, true);
            assert_eq!(
                records
                    .iter()
                    .filter(|row| row["kind"] == "sql-count")
                    .count(),
                32
            );
            assert!(records
                .iter()
                .filter(|row| row["kind"] == "sql-count")
                .all(|row| row["matched"] == false));
            assert!(trace.poll(180_001, true).is_empty());
        }
    }
}

#[cfg(feature = "startup-sql-trace")]
pub use enabled::*;

#[cfg(not(feature = "startup-sql-trace"))]
pub const RESERVE: usize = 0;

#[cfg(not(feature = "startup-sql-trace"))]
#[derive(Default)]
pub struct JournalTrace;

#[cfg(not(feature = "startup-sql-trace"))]
impl JournalTrace {
    pub fn enabled(&self) -> bool {
        false
    }
    pub fn observing(&self) -> bool {
        false
    }
    pub fn stop(&self) {}
    pub fn frontend(&self, _: &str, _: u64, _: crate::startup::StartupSqlFrontend) {}
    pub fn poll(&self, _: u64, _: bool) -> Vec<serde_json::Value> {
        Vec::new()
    }
}
