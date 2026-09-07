//! One opt-in generated-only overhead screen. Never an app startup acceptance test.
use super::*;
use rusqlite::{types::ValueRef, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::Write,
    time::Duration,
};
use tauri_plugin_sql::startup_trace::Collector;

const LABELS: [&str; 4] = ["collection", "maintenance", "gallery", "global-gallery"];
const LIMIT: Duration = Duration::from_secs(20 * 60);

// Owner-approved generated-only lifetime marker. Its unused collation is never named
// by a measured query. The closure's destruction detects handle closure even if SQLite
// subsequently reuses the same address. Neither addresses nor marker names are evidence.
#[derive(Default)]
struct MarkerState {
    closed: std::sync::atomic::AtomicUsize,
    called: std::sync::atomic::AtomicUsize,
}
struct LifetimeMarker(std::sync::Arc<MarkerState>);
impl Drop for LifetimeMarker {
    fn drop(&mut self) {
        self.0
            .closed
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
}

struct PoolObservation {
    settings: Vec<Value>,
    identities: Vec<usize>,
    untreated_settings: Option<Vec<Value>>,
}

fn observe_pool(
    pool: &sqlx::SqlitePool,
    install: Option<&std::sync::Arc<MarkerState>>,
) -> PoolObservation {
    observe_prepared_pool(pool, install, false)
}

fn observe_prepared_pool(
    pool: &sqlx::SqlitePool,
    install: Option<&std::sync::Arc<MarkerState>>,
    uniform_defaults: bool,
) -> PoolObservation {
    assert_eq!(
        pool.options().get_max_connections(),
        10,
        "unchanged pool size"
    );
    let mut held = super::super::acquire_connections(pool, 10);
    let mut identities = tauri::async_runtime::block_on(async {
        let mut identities = Vec::new();
        for conn in &mut held {
            let mut handle = conn.lock_handle().await.unwrap();
            identities.push(handle.as_raw_handle().as_ptr() as usize);
            if let Some(state) = install {
                let marker = LifetimeMarker(state.clone());
                handle
                    .create_collation("ambit_generated_overlap_lifetime", move |a, b| {
                        marker
                            .0
                            .called
                            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        // Capture the complete Drop-bearing marker, not just its Arc field.
                        std::hint::black_box(&marker);
                        a.cmp(b)
                    })
                    .unwrap();
            }
        }
        identities
    });
    let untreated_settings = uniform_defaults.then(|| {
        let mut rows = super::super::pragma_snapshots(&mut held);
        for row in &mut rows {
            row.as_object_mut().unwrap().remove("connection_slot");
        }
        rows.sort_by_key(Value::to_string);
        assert!(
            expected_settings(&rows),
            "unexpected untreated pool settings"
        );
        rows
    });
    if uniform_defaults {
        // Generated-only fixed treatment, once while every physical connection is held.
        // WAL is already established. No journal-mode change or retry/retuning occurs.
        tauri::async_runtime::block_on(async {
            for conn in &mut held {
                for query in [
                    "PRAGMA synchronous=2",
                    "PRAGMA busy_timeout=5000",
                    "PRAGMA cache_size=-2000",
                    "PRAGMA temp_store=0",
                    "PRAGMA mmap_size=0",
                ] {
                    sqlx::query(query).execute(&mut **conn).await.unwrap();
                }
            }
        });
    }
    let mut settings = super::super::pragma_snapshots(&mut held);
    for row in &mut settings {
        row.as_object_mut().unwrap().remove("connection_slot");
    }
    settings.sort_by_key(Value::to_string);
    if uniform_defaults {
        assert!(
            uniform_default_settings(&settings),
            "treatment must cover all held connections"
        );
    }
    identities.sort_unstable();
    assert_eq!(
        identities
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len(),
        10
    );
    drop(held);
    PoolObservation {
        settings,
        identities,
        untreated_settings,
    }
}

fn uniform_default_settings(settings: &[Value]) -> bool {
    let expected = json!({"journal_mode":"wal","synchronous":2,"busy_timeout":5000,"cache_size":-2000,"temp_store":0,"mmap_size":0});
    settings.len() == 10 && settings.iter().all(|row| *row == expected)
}

#[test]
fn overlap_uniform_defaults_cover_every_physical_connection_without_retuning() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("uniform.db");
    seed_wide(&path, 10_000, 1_000);
    let queries = super::super::count_read_only_probe::generated_trace_queries();
    let expected = {
        let conn = Connection::open(&path).unwrap();
        set_scope(&conn, "all", "", true);
        queries
            .iter()
            .map(|query| direct_count_rows(&conn, query))
            .collect::<Vec<_>>()
    };
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&path);
    configure_via_ipc(&sql, &db);
    let pool = sql.pool(&db);
    let marker = std::sync::Arc::new(MarkerState::default());
    let before = observe_prepared_pool(&pool, Some(&marker), true);
    assert!(
        uniform_default_settings(&before.settings),
        "all ten physical connections must receive the fixed treatment"
    );
    assert!(before.untreated_settings.is_some());
    for (query, expected) in queries.iter().zip(&expected) {
        let actual = ipc(
            &sql.webview,
            "select",
            json!({"db":db,"query":query,"values":[]}),
        );
        assert_eq!(
            sorted_rows(actual),
            *expected,
            "fixed treatment preserves exact count results"
        );
    }
    assert!(stable_pool(&before, &observe_pool(&pool, None), &marker));
    let mut changed = before.settings.clone();
    changed[0]["mmap_size"] = json!(268435456);
    assert!(!uniform_default_settings(&changed));
    assert!(!uniform_default_settings(&before.settings[..9]));
    tauri::async_runtime::block_on(async {
        let mut conn = pool.acquire().await.unwrap();
        sqlx::query("PRAGMA cache_size=-64000")
            .execute(&mut *conn)
            .await
            .unwrap();
    });
    let after = observe_pool(&pool, None);
    assert!(
        !uniform_default_settings(&after.settings),
        "observation must not silently retune changed settings"
    );
    assert!(!stable_pool(&before, &after, &marker));
}

fn stable_pool(before: &PoolObservation, after: &PoolObservation, marker: &MarkerState) -> bool {
    before.identities == after.identities
        && before.settings == after.settings
        && marker.closed.load(std::sync::atomic::Ordering::SeqCst) == 0
        && marker.called.load(std::sync::atomic::Ordering::SeqCst) == 0
}

fn expected_settings(settings: &[Value]) -> bool {
    settings.len() == 10
        && settings.iter().all(|row| {
            row.as_object().is_some_and(|object| object.len() == 6)
                && row["journal_mode"] == "wal"
                && [
                    ("synchronous", &[1_i64, 2][..]),
                    ("busy_timeout", &[5000, 60000][..]),
                    ("cache_size", &[-2000, -64000][..]),
                    ("temp_store", &[0, 2][..]),
                    ("mmap_size", &[0, 268435456][..]),
                ]
                .iter()
                .all(|(name, allowed)| {
                    row[*name]
                        .as_i64()
                        .is_some_and(|value| allowed.contains(&value))
                })
        })
}

fn matching_settings(settings: &[Value], paired: Option<&[Value]>) -> bool {
    expected_settings(settings) && paired.is_none_or(|other| other == settings)
}

#[test]
fn overlap_settings_and_identity_checks_reject_invalid_comparisons() {
    let setting = json!({"journal_mode":"wal","synchronous":2,"busy_timeout":5000,"cache_size":-2000,"temp_store":0,"mmap_size":0});
    let before = PoolObservation {
        settings: vec![setting; 10],
        identities: (0..10).collect(),
        untreated_settings: None,
    };
    let marker = MarkerState::default();
    assert!(matching_settings(&before.settings, None));
    assert!(matching_settings(&before.settings, Some(&before.settings)));
    let mut after = PoolObservation {
        settings: before.settings.clone(),
        identities: before.identities.clone(),
        untreated_settings: None,
    };
    assert!(stable_pool(&before, &after, &marker));
    after.settings[0]["busy_timeout"] = json!(60000);
    assert!(
        expected_settings(&after.settings),
        "individually allowed settings still require paired equality"
    );
    assert!(!matching_settings(&after.settings, Some(&before.settings)));
    assert!(
        !stable_pool(&before, &after, &marker),
        "settings changes invalidate even with identical handles"
    );
    after.settings = before.settings.clone();
    after.identities[0] = 100;
    assert!(!stable_pool(&before, &after, &marker));
    after.identities = before.identities.clone();
    marker.called.store(1, std::sync::atomic::Ordering::SeqCst);
    assert!(
        !stable_pool(&before, &after, &marker),
        "measured queries must not invoke the lifetime marker"
    );
    for (key, value) in [
        ("busy_timeout", json!(123)),
        ("mmap_size", Value::Null),
        ("cache_size", json!("NaN")),
        ("journal_mode", json!("delete")),
    ] {
        let mut bad = before.settings.clone();
        bad[0][key] = value;
        assert!(!matching_settings(&bad, None));
    }
    assert!(!matching_settings(&before.settings[..9], None));
    let distribution = settings_distribution(&before.settings);
    assert_eq!(distribution.len(), 1);
    assert_eq!(distribution[0][6], 10);
}

#[test]
fn overlap_marker_detects_replacement_and_never_runs_for_unchanged_counts() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("marker.db");
    seed_wide(&path, 10_000, 1_000);
    let queries = super::super::count_read_only_probe::generated_trace_queries();
    let expected = {
        let conn = Connection::open(&path).unwrap();
        set_scope(&conn, "all", "", true);
        queries
            .iter()
            .map(|query| direct_count_rows(&conn, query))
            .collect::<Vec<_>>()
    };
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&path);
    configure_via_ipc(&sql, &db);
    let pool = sql.pool(&db);
    let marker = std::sync::Arc::new(MarkerState::default());
    let before = observe_pool(&pool, Some(&marker));
    assert!(expected_settings(&before.settings));
    for _ in 0..2 {
        for (query, expected) in queries.iter().zip(&expected) {
            let actual = ipc(
                &sql.webview,
                "select",
                json!({"db":db,"query":query,"values":[]}),
            );
            assert!(
                sorted_rows(actual) == *expected,
                "marker preserves unchanged query results"
            );
        }
        assert!(stable_pool(&before, &observe_pool(&pool, None), &marker));
    }
    tauri::async_runtime::block_on(async {
        pool.acquire().await.unwrap().close().await.unwrap();
    });
    let after = observe_pool(&pool, None);
    assert!(
        !stable_pool(&before, &after, &marker),
        "replacement invalidates even if its address is reused"
    );
    assert_eq!(marker.closed.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(marker.called.load(std::sync::atomic::Ordering::SeqCst), 0);
    let simulated_reuse = PoolObservation {
        settings: before.settings.clone(),
        identities: before.identities.clone(),
        untreated_settings: None,
    };
    assert!(
        !stable_pool(&before, &simulated_reuse, &marker),
        "ABA cannot conceal a closed original"
    );
}

struct Observer(std::sync::Arc<crate::startup_log::StartupJournal>);
impl Drop for Observer {
    fn drop(&mut self) {
        self.0.request_end();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !self.0.sql_observation_finished() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}

struct Report {
    file: File,
    sequence: usize,
    bytes: usize,
    terminal: bool,
}

trait Evidence {
    fn record(&mut self, value: Value);
}
impl Report {
    fn record(&mut self, mut value: Value) {
        value["sequence"] = json!(self.sequence);
        let mut bytes = serde_json::to_vec(&value).unwrap();
        bytes.push(b'\n');
        assert!(
            self.bytes + bytes.len() < 248 * 1024,
            "bounded overhead evidence"
        );
        self.file.write_all(&bytes).unwrap();
        self.file.flush().unwrap();
        self.bytes += bytes.len();
        self.sequence += 1;
    }
    fn finish(&mut self, status: &str, elapsed: Duration) {
        self.record(
            json!({"kind":"terminal","status":status,"elapsedMs":elapsed.as_secs_f64()*1000.0}),
        );
        self.terminal = true;
    }
}
impl Evidence for Report {
    fn record(&mut self, value: Value) {
        Report::record(self, value);
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum PreparationStage {
    DirectoryCreation,
    FixtureGeneration,
    FixtureCopy,
    ConnectionOpening,
    OwnershipAssignment,
    ScopeSetup,
    FixtureValidation,
    BypassInstallation,
    Analysis,
    Checkpointing,
    EqualityCheck,
    FileSizeInspection,
}
impl PreparationStage {
    fn label(self) -> &'static str {
        match self {
            Self::DirectoryCreation => "directory-creation",
            Self::FixtureGeneration => "fixture-generation",
            Self::FixtureCopy => "fixture-copy",
            Self::ConnectionOpening => "connection-opening",
            Self::OwnershipAssignment => "ownership-assignment",
            Self::ScopeSetup => "scope-setup",
            Self::FixtureValidation => "fixture-validation",
            Self::BypassInstallation => "bypass-installation",
            Self::Analysis => "analysis",
            Self::Checkpointing => "checkpointing",
            Self::EqualityCheck => "equality-check",
            Self::FileSizeInspection => "file-size-inspection",
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum PreparationCategory {
    Sqlite,
    Os,
    Validation,
    Unknown,
}
impl PreparationCategory {
    fn label(self) -> &'static str {
        match self {
            Self::Sqlite => "sqlite",
            Self::Os => "os",
            Self::Validation => "validation",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct OwnershipPreparationFailure {
    stage: PreparationStage,
    condition: Option<&'static str>,
    block: Option<usize>,
    elapsed: Duration,
    category: PreparationCategory,
    sqlite_code: Option<i32>,
    os_code: Option<i32>,
    legacy_status: &'static str,
}
impl OwnershipPreparationFailure {
    fn os(
        stage: PreparationStage,
        condition: Option<&'static str>,
        block: Option<usize>,
        elapsed: Duration,
        os_code: Option<i32>,
    ) -> Self {
        Self {
            stage,
            condition,
            block,
            elapsed,
            category: PreparationCategory::Os,
            sqlite_code: None,
            os_code,
            legacy_status: "fixture-setup-failed",
        }
    }
    fn sqlite(
        stage: PreparationStage,
        condition: Option<&'static str>,
        block: Option<usize>,
        elapsed: Duration,
        sqlite_code: i32,
    ) -> Self {
        Self {
            stage,
            condition,
            block,
            elapsed,
            category: PreparationCategory::Sqlite,
            sqlite_code: Some(sqlite_code),
            os_code: None,
            legacy_status: "fixture-setup-failed",
        }
    }
    fn sqlite_without_code(
        stage: PreparationStage,
        condition: Option<&'static str>,
        block: Option<usize>,
        elapsed: Duration,
    ) -> Self {
        Self {
            stage,
            condition,
            block,
            elapsed,
            category: PreparationCategory::Sqlite,
            sqlite_code: None,
            os_code: None,
            legacy_status: "fixture-setup-failed",
        }
    }
    fn validation(
        stage: PreparationStage,
        condition: Option<&'static str>,
        block: Option<usize>,
        elapsed: Duration,
    ) -> Self {
        Self {
            stage,
            condition,
            block,
            elapsed,
            category: PreparationCategory::Validation,
            sqlite_code: None,
            os_code: None,
            legacy_status: "fixture-setup-failed",
        }
    }
    fn unknown(
        stage: PreparationStage,
        condition: Option<&'static str>,
        block: Option<usize>,
        elapsed: Duration,
    ) -> Self {
        Self {
            stage,
            condition,
            block,
            elapsed,
            category: PreparationCategory::Unknown,
            sqlite_code: None,
            os_code: None,
            legacy_status: "fixture-setup-failed",
        }
    }
    fn stage(self) -> &'static str {
        self.stage.label()
    }
    fn category(self) -> &'static str {
        self.category.label()
    }
    fn sqlite_code(self) -> Option<i32> {
        self.sqlite_code
    }
    fn os_code(self) -> Option<i32> {
        self.os_code
    }
    fn with_legacy_status(mut self, status: &'static str) -> Self {
        self.legacy_status = status;
        self
    }
    fn legacy_status(self) -> &'static str {
        self.legacy_status
    }
    fn json(self) -> Value {
        let mut detail = json!({"stage":self.stage(),"elapsedMs":self.elapsed.as_secs_f64()*1000.0,"category":self.category()});
        if let (Some(condition), Some(block)) = (self.condition, self.block) {
            detail["condition"] = json!(condition);
            detail["block"] = json!(block);
        }
        if let Some(code) = self.sqlite_code {
            detail["sqliteCode"] = json!(code);
        }
        if let Some(code) = self.os_code {
            detail["osCode"] = json!(code);
        }
        detail
    }
}

struct OwnershipPreparation<'a> {
    report: Option<&'a mut OwnershipReport>,
    campaign: Instant,
    condition: Option<&'static str>,
    block: Option<usize>,
    last_stage: Option<PreparationStage>,
    next_fixture_id: usize,
}
impl<'a> OwnershipPreparation<'a> {
    fn enter(&mut self, stage: PreparationStage) {
        self.last_stage = Some(stage);
        let mut record = json!({"kind":"preparation-stage","stage":stage.label(),"elapsedMs":self.campaign.elapsed().as_secs_f64()*1000.0});
        if let (Some(condition), Some(block)) = (self.condition, self.block) {
            record["condition"] = json!(condition);
            record["block"] = json!(block);
        }
        self.record(record);
    }
    fn validation_failure(&self) -> OwnershipPreparationFailure {
        OwnershipPreparationFailure::validation(
            self.last_stage
                .unwrap_or(PreparationStage::FixtureGeneration),
            self.condition,
            self.block,
            self.campaign.elapsed(),
        )
    }
    fn unknown_failure(&self) -> OwnershipPreparationFailure {
        OwnershipPreparationFailure::unknown(
            self.last_stage
                .unwrap_or(PreparationStage::FixtureGeneration),
            self.condition,
            self.block,
            self.campaign.elapsed(),
        )
    }
    fn sqlite_failure(&self, error: &rusqlite::Error) -> OwnershipPreparationFailure {
        let stage = self
            .last_stage
            .unwrap_or(PreparationStage::FixtureGeneration);
        match preparation_sqlite_code(error) {
            Some(code) => OwnershipPreparationFailure::sqlite(
                stage,
                self.condition,
                self.block,
                self.campaign.elapsed(),
                code,
            ),
            _ => OwnershipPreparationFailure::sqlite_without_code(
                stage,
                self.condition,
                self.block,
                self.campaign.elapsed(),
            ),
        }
    }
    fn os_failure(&self, error: &std::io::Error) -> OwnershipPreparationFailure {
        OwnershipPreparationFailure::os(
            self.last_stage
                .unwrap_or(PreparationStage::FixtureGeneration),
            self.condition,
            self.block,
            self.campaign.elapsed(),
            error.raw_os_error(),
        )
    }

    // Callers return only owned result data, never live database/pool handles. The
    // callback's resources unwind before the one explicit guarded cleanup attempt.
    fn with_directory<T>(
        &mut self,
        work: impl FnOnce(&GeneratedBenchmarkDir, &mut Self) -> Result<T, OwnershipCampaignFailure>,
    ) -> Result<T, OwnershipCampaignFailure> {
        let fixture_id = self.next_fixture_id;
        self.next_fixture_id += 1;
        let mut directory = None;
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.enter(PreparationStage::DirectoryCreation);
            directory = Some(GeneratedBenchmarkDir::try_new().map_err(|error| {
                OwnershipCampaignFailure::Preparation(
                    self.os_failure(&error).with_legacy_status("failed"),
                )
            })?);
            work(directory.as_ref().unwrap(), self)
        }))
        .unwrap_or_else(|_| {
            Err(OwnershipCampaignFailure::Preparation(
                self.unknown_failure().with_legacy_status("failed"),
            ))
        });
        let cleanup = directory
            .as_mut()
            .map(|directory| directory.cleanup())
            .unwrap_or(crate::db::migrations::tests::GeneratedCleanupOutcome::Unobserved);
        self.record(json!({"kind":"fixture-cleanup","fixtureId":fixture_id,"outcome":cleanup_label(cleanup)}));
        preserve_preparation_result(result, cleanup)
    }
}

fn preparation_sqlite_code(error: &rusqlite::Error) -> Option<i32> {
    match error {
        rusqlite::Error::SqliteFailure(error, _) | rusqlite::Error::SqlInputError { error, .. } => {
            Some(error.extended_code)
        }
        _ => None,
    }
}

impl Evidence for OwnershipPreparation<'_> {
    fn record(&mut self, value: Value) {
        if let Some(report) = self.report.as_deref_mut() {
            report.record(value);
        }
    }
}

fn cleanup_label(outcome: crate::db::migrations::tests::GeneratedCleanupOutcome) -> &'static str {
    use crate::db::migrations::tests::GeneratedCleanupOutcome::*;
    match outcome {
        Removed => "removed",
        AlreadyAbsent => "already-absent",
        RetainedForSafety => "retained-for-safety",
        Failed => "failed",
        Unobserved => "unobserved",
    }
}

fn preserve_preparation_result<T>(
    result: Result<T, OwnershipCampaignFailure>,
    cleanup: crate::db::migrations::tests::GeneratedCleanupOutcome,
) -> Result<T, OwnershipCampaignFailure> {
    use crate::db::migrations::tests::GeneratedCleanupOutcome::*;
    match result {
        Err(original) => Err(original),
        Ok(value) if matches!(cleanup, Removed | AlreadyAbsent) => Ok(value),
        Ok(_) => Err(OwnershipCampaignFailure::Terminal("failed")),
    }
}

// Kept separate from the historical overlap report so its 248 KiB cap remains
// unchanged. Ownership qualification has six cohorts and reserves terminal room.
struct OwnershipReport {
    file: File,
    sequence: usize,
    bytes: usize,
    terminal: bool,
    dropped: usize,
    storage_failed: bool,
}
impl OwnershipReport {
    const LIMIT: usize = 1024 * 1024;
    const TERMINAL_RESERVE: usize = 8 * 1024;
    fn new(file: File) -> Self {
        Self {
            file,
            sequence: 0,
            bytes: 0,
            terminal: false,
            dropped: 0,
            storage_failed: false,
        }
    }

    fn record_inner(&mut self, mut value: Value) {
        value["sequence"] = json!(self.sequence);
        let terminal = value["kind"] == "terminal";
        let Ok(mut bytes) = serde_json::to_vec(&value) else {
            self.dropped = self.dropped.saturating_add(1);
            return;
        };
        bytes.push(b'\n');
        let limit = if terminal {
            Self::LIMIT
        } else {
            Self::LIMIT - Self::TERMINAL_RESERVE
        };
        if self.storage_failed || self.bytes.saturating_add(bytes.len()) >= limit {
            self.dropped = self.dropped.saturating_add(1);
            return;
        }
        if self.file.write_all(&bytes).is_err() || self.file.flush().is_err() {
            self.storage_failed = true;
            self.dropped = self.dropped.saturating_add(1);
            return;
        }
        self.bytes += bytes.len();
        self.sequence += 1;
    }
    fn finish(
        &mut self,
        status: &'static str,
        elapsed: Duration,
        preparation_failure: Option<OwnershipPreparationFailure>,
    ) -> &'static str {
        let status = if status == "completed" && (self.dropped != 0 || self.storage_failed) {
            "incomplete-trace"
        } else {
            status
        };
        let mut terminal = json!({"kind":"terminal","status":status,"elapsedMs":elapsed.as_secs_f64()*1000.0,"droppedRecords":self.dropped,"storageUnavailable":self.storage_failed});
        if let Some(preparation_failure) = preparation_failure {
            terminal["preparationFailure"] = preparation_failure.json();
        }
        self.record_inner(terminal);
        self.terminal = true;
        if status == "completed" && self.storage_failed {
            "incomplete-trace"
        } else {
            status
        }
    }
}
impl Evidence for OwnershipReport {
    fn record(&mut self, value: Value) {
        self.record_inner(value);
    }
}
impl Drop for OwnershipReport {
    fn drop(&mut self) {
        if !self.terminal {
            self.record_inner(json!({"kind":"terminal","status":"interrupted","droppedRecords":self.dropped,"storageUnavailable":self.storage_failed}));
        }
    }
}
impl Drop for Report {
    fn drop(&mut self) {
        if !self.terminal {
            let _ = writeln!(
                self.file,
                "{{\"kind\":\"terminal\",\"sequence\":{},\"status\":\"interrupted\"}}",
                self.sequence
            );
        }
    }
}

const OVERLAP_LIMIT: Duration = Duration::from_secs(30 * 60);
const ARM_TRACE_LIMIT: Duration = Duration::from_secs(180);

fn overlap_order(pair: usize) -> [usize; 4] {
    if pair % 2 == 0 {
        [0, 1, 2, 3]
    } else {
        [3, 2, 1, 0]
    }
}

fn overlap_control(kind: &str, round: usize) {
    println!(
        "AMBIT_OVERLAP_CONTROL {}",
        json!({"kind":kind,"roundId":round})
    );
    std::io::stdout().flush().unwrap();
}

#[derive(Clone, Copy, Default)]
struct OverlapSample {
    ipc: f64,
    native: f64,
    started: f64,
    registry: f64,
    bind: f64,
    acquire: f64,
    fetch: f64,
    decode: f64,
}

struct OverlapArm {
    samples: [OverlapSample; 16],
    settings: Vec<Value>,
}

fn nonnegative(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .filter(|value| value.is_finite() && *value >= 0.0)
}

// The observer alone drains the collector. Missing, duplicate, foreign or mismatched
// records invalidate the arm instead of inventing zero-duration native boundaries.
fn overlap_native(
    records: &[Value],
    samples: &mut [OverlapSample; 16],
    launch: &str,
    expected: usize,
    final_check: bool,
) -> bool {
    if expected == 0 || expected > 16 || (final_check && expected != 16) {
        return false;
    }
    let summaries: Vec<_> = records
        .iter()
        .filter(|row| row["kind"] == "sql-trace-summary")
        .collect();
    if final_check {
        if summaries.len() != 1 {
            return false;
        }
        let summary = summaries[0];
        if summary["launchId"] != launch
            || summary["detailedAdmitted"] != 16
            || summary["matchedOrReported"] != 16
            || [
                "detailedPending",
                "coarsePending",
                "detailedDropped",
                "coarseDropped",
                "frontendDropped",
            ]
            .iter()
            .any(|key| summary[*key] != 0)
            || !matches!(summary["status"].as_str(), Some("teardown" | "settled"))
        {
            return false;
        }
        let terminal: Vec<_> = records
            .iter()
            .filter(|row| row["kind"] == "summary")
            .collect();
        if terminal.len() != 1
            || terminal[0]["launchId"] != launch
            || terminal[0]["sqlTraceStorageDropped"] != 0
        {
            return false;
        }
    } else if !summaries.is_empty() {
        return false;
    }
    let mut seen = [false; 16];
    for row in records.iter().filter(|row| row["kind"] == "sql-count") {
        let Some(id) = row["callId"].as_u64().and_then(|n| usize::try_from(n).ok()) else {
            return false;
        };
        if !(1..=expected).contains(&id) || seen[id - 1] {
            return false;
        }
        let native = &row["native"];
        let frontend = &row["frontend"];
        if row["launchId"] != launch
            || frontend["launchId"] != launch
            || frontend["callId"] != id
            || frontend["label"] != LABELS[(id - 1) % 4]
            || frontend["status"] != "completed"
            || frontend["durationMs"].as_u64() != Some(samples[id - 1].ipc.ceil() as u64)
            || row["matched"] != true
            || native["status"] != "completed"
            || native["callId"] != id
            || native["label"] != LABELS[(id - 1) % 4]
            || native["role"] != "main"
            || native["operation"] != "select"
        {
            return false;
        }
        let timings = &native["timings"];
        let numbers = [
            &native["startedMs"],
            &native["elapsedMs"],
            &timings["registryWaitMs"],
            &timings["bindMs"],
            &timings["acquireMs"],
            &timings["fetchMs"],
            &timings["decodeMs"],
        ];
        let Some(numbers) = numbers
            .into_iter()
            .map(nonnegative)
            .collect::<Option<Vec<_>>>()
        else {
            return false;
        };
        if numbers[2..].iter().sum::<f64>() > numbers[1] + 0.001 {
            return false;
        }
        let sample = &mut samples[id - 1];
        sample.started = numbers[0];
        sample.native = numbers[1];
        sample.registry = numbers[2];
        sample.bind = numbers[3];
        sample.acquire = numbers[4];
        sample.fetch = numbers[5];
        sample.decode = numbers[6];
        seen[id - 1] = true;
    }
    seen[..expected].iter().all(|seen| *seen)
}

fn dispatch_overlap<R: Send>(
    order: [usize; 4],
    concurrent: bool,
    run: impl Fn(usize) -> R + Sync,
    mut check: impl FnMut(usize, R) -> Result<(), &'static str>,
) -> Result<(), &'static str> {
    if concurrent {
        let barrier = std::sync::Barrier::new(4);
        let results = std::thread::scope(|scope| {
            let handles: Vec<_> = order
                .into_iter()
                .map(|q| {
                    let barrier = &barrier;
                    let run = &run;
                    scope.spawn(move || {
                        barrier.wait();
                        (q, run(q))
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect::<Vec<_>>()
        });
        for (q, result) in results {
            check(q, result)?;
        }
    } else {
        for q in order {
            check(q, run(q))?;
        }
    }
    Ok(())
}

fn settings_distribution(settings: &[Value]) -> Vec<Value> {
    let mut result = Vec::new();
    for setting in settings {
        let row = json!([
            setting["journal_mode"],
            setting["synchronous"],
            setting["busy_timeout"],
            setting["cache_size"],
            setting["temp_store"],
            setting["mmap_size"],
            1
        ]);
        if let Some(previous) = result.last_mut().filter(|previous: &&mut Value| {
            previous.as_array().unwrap()[..6] == row.as_array().unwrap()[..6]
        }) {
            previous[6] = json!(previous[6].as_u64().unwrap() + 1);
        } else {
            result.push(row);
        }
    }
    result
}

fn overlap_arm<E: Evidence>(
    template: &Path,
    queries: &[String; 4],
    expected: &[Vec<Value>],
    catalog: usize,
    pair: usize,
    concurrent: bool,
    round: &mut usize,
    campaign: Instant,
    campaign_limit: Duration,
    report: &mut E,
    paired_settings: Option<&[Value]>,
    uniform_defaults: bool,
) -> Result<OverlapArm, &'static str> {
    let arm_directory = GeneratedBenchmarkDir::new();
    let path = arm_directory.path.join("overlap.db");
    std::fs::copy(template, &path).map_err(|_| "failed")?;
    overlap_arm_in(
        &arm_directory,
        queries,
        expected,
        catalog,
        pair,
        concurrent,
        round,
        campaign,
        campaign_limit,
        report,
        paired_settings,
        uniform_defaults,
    )
}

fn overlap_arm_in<E: Evidence>(
    arm_directory: &GeneratedBenchmarkDir,
    queries: &[String; 4],
    expected: &[Vec<Value>],
    catalog: usize,
    pair: usize,
    concurrent: bool,
    round: &mut usize,
    campaign: Instant,
    campaign_limit: Duration,
    report: &mut E,
    paired_settings: Option<&[Value]>,
    uniform_defaults: bool,
) -> Result<OverlapArm, &'static str> {
    let path = arm_directory.path.join("overlap.db");
    let origin = Instant::now();
    let journal = std::sync::Arc::new(crate::startup_log::StartupJournal::new(
        origin,
        Some(&arm_directory.path.join("logs")),
    ));
    let launch = journal.launch_id.clone();
    let collector = Collector::new(
        launch.clone(),
        vec![super::super::fixture_url(&path)],
        origin,
    );
    journal.install_sql_trace(collector.clone());
    journal.start_observer();
    let _observer = Observer(journal.clone());
    let sql = MockSql::with_builder(
        &arm_directory.path,
        tauri_plugin_sql::Builder::default().startup_trace(collector),
        &[],
    );
    let opening = Instant::now();
    let db = sql.load(&path);
    let opening_ms = opening.elapsed().as_secs_f64() * 1000.0;
    configure_via_ipc(&sql, &db);
    let pool = sql.pool(&db);
    let marker = std::sync::Arc::new(MarkerState::default());
    let preparation = Instant::now();
    let before = observe_prepared_pool(&pool, Some(&marker), uniform_defaults);
    report.record(json!({"kind":"pool","catalog":catalog,"pair":pair,"concurrent":concurrent,
        "stage":"before","openingMs":opening_ms,"preparationMs":preparation.elapsed().as_secs_f64()*1000.0,
        "untreatedDistribution":before.untreated_settings.as_ref().map(|rows|settings_distribution(rows)),
        "distribution":settings_distribution(&before.settings),"markerPolicy":"unused-collation-lifetime-v1"}));
    if !matching_settings(&before.settings, paired_settings)
        || (uniform_defaults && !uniform_default_settings(&before.settings))
    {
        return Err("invalid-comparison");
    }
    let mut samples = [OverlapSample::default(); 16];
    let journal_path = arm_directory
        .path
        .join("logs")
        .join(format!("startup-{launch}.jsonl"));
    for repetition in 0..4 {
        if campaign.elapsed() >= campaign_limit {
            return Err("timed-out");
        }
        if origin.elapsed() >= ARM_TRACE_LIMIT {
            return Err("incomplete-trace");
        }
        overlap_control("overlap-round-start", *round);
        let round_start = Instant::now();
        let view = sql.webview.clone();
        let result = dispatch_overlap(
            overlap_order(pair),
            concurrent,
            |q| {
                let timer = Instant::now();
                let result = super::super::ipc_result(
                    &view,
                    "select",
                    json!({"db":db,"query":queries[q],"values":[],
                "startupTrace":{"launchId":launch,"callId":repetition*4+q+1,"label":LABELS[q]}}),
                );
                (result, timer.elapsed().as_secs_f64() * 1000.0)
            },
            |q, (result, ms)| {
                let id = repetition * 4 + q + 1;
                let result = result.map_err(|_| "query-failed")?;
                let equal = sorted_rows(result) == expected[q];
                samples[id - 1].ipc = ms;
                journal.sql_frontend(crate::startup::StartupSqlFrontend {
                    launch_id: launch.clone(),
                    call_id: id as u32,
                    label: serde_json::from_value(json!(LABELS[q])).unwrap(),
                    duration_ms: ms.ceil() as u64,
                    status: crate::startup::StartupSqlStatus::Completed,
                });
                report.record(
                    json!({"kind":"ipc","data":[catalog,pair,concurrent,repetition,q,id,ms,equal]}),
                );
                if !equal {
                    return Err("result-mismatch");
                }
                Ok(())
            },
        );
        overlap_control("overlap-round-end", *round);
        *round += 1;
        if overlap_deadline_expired(round_start.elapsed(), campaign.elapsed(), campaign_limit) {
            return Err("timed-out");
        }
        result?;
        // Read only complete lines; a concurrent observer write may leave a partial tail.
        // No competing collector drain and no per-query observer waits during the round.
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let text = std::fs::read_to_string(&journal_path).map_err(|_| "incomplete-trace")?;
            let lines = text
                .rsplit_once('\n')
                .map(|(complete, _)| complete)
                .unwrap_or("");
            let records = lines
                .lines()
                .map(serde_json::from_str)
                .collect::<Result<Vec<Value>, _>>()
                .map_err(|_| "incomplete-trace")?;
            if overlap_native(&records, &mut samples, &launch, (repetition + 1) * 4, false) {
                break;
            }
            if Instant::now() >= deadline || origin.elapsed() >= ARM_TRACE_LIMIT {
                journal.request_end();
                super::super::wait_until("incomplete overlap teardown", || {
                    journal.sql_observation_finished()
                });
                let final_text =
                    std::fs::read_to_string(&journal_path).map_err(|_| "incomplete-trace")?;
                for line in final_text.lines() {
                    let row: Value = serde_json::from_str(line).map_err(|_| "incomplete-trace")?;
                    if row["kind"] == "sql-trace-summary" {
                        report.record(json!({"kind":"trace-incomplete","catalog":catalog,"pair":pair,"concurrent":concurrent,
                            "read":repetition,"expectedCount":(repetition+1)*4,"observedCount":records.iter().filter(|row|row["kind"]=="sql-count").count(),
                            "detailedAdmitted":row["detailedAdmitted"],"detailedDropped":row["detailedDropped"],
                            "coarseDropped":row["coarseDropped"],"frontendDropped":row["frontendDropped"]}));
                    }
                }
                return Err("incomplete-trace");
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        for q in 0..4 {
            let id = repetition * 4 + q + 1;
            let sample = samples[id - 1];
            report.record(json!({"kind":"native","data":[catalog,pair,concurrent,repetition,q,id,sample.started,sample.native,
                sample.registry,sample.bind,sample.acquire,sample.fetch,sample.decode]}));
        }
    }
    if origin.elapsed() >= ARM_TRACE_LIMIT {
        return Err("incomplete-trace");
    }
    let after = observe_pool(&pool, None);
    let stable = stable_pool(&before, &after, &marker);
    report.record(
        json!({"kind":"pool","catalog":catalog,"pair":pair,"concurrent":concurrent,
        "stage":"after","distribution":settings_distribution(&after.settings),"stable":stable,
        "closedOriginals":marker.closed.load(std::sync::atomic::Ordering::SeqCst),
        "markerCalls":marker.called.load(std::sync::atomic::Ordering::SeqCst)}),
    );
    if !stable || (uniform_defaults && !uniform_default_settings(&after.settings)) {
        return Err("invalid-comparison");
    }
    journal.request_end();
    super::super::wait_until("overlap journal teardown", || {
        journal.sql_observation_finished()
    });
    let text = std::fs::read_to_string(
        arm_directory
            .path
            .join("logs")
            .join(format!("startup-{launch}.jsonl")),
    )
    .map_err(|_| "incomplete-trace")?;
    let records = text
        .lines()
        .map(serde_json::from_str)
        .collect::<Result<Vec<Value>, _>>()
        .map_err(|_| "incomplete-trace")?;
    if !overlap_native(&records, &mut samples, &launch, 16, true) {
        return Err("incomplete-trace");
    }
    for repetition in 0..4 {
        let mut overlaps = Vec::new();
        for a in 0..4 {
            for b in a + 1..4 {
                let first = samples[repetition * 4 + a];
                let second = samples[repetition * 4 + b];
                let duration = (first.started + first.native).min(second.started + second.native)
                    - first.started.max(second.started);
                overlaps.push(duration.max(0.0));
            }
        }
        report.record(
            json!({"kind":"overlap","catalog":catalog,"pair":pair,"concurrent":concurrent,
            "read":repetition,"nativePairOverlapMs":overlaps,"pairOrder":"01-02-03-12-13-23"}),
        );
    }
    Ok(OverlapArm {
        samples,
        settings: before.settings,
    })
}

fn overlap_penalty(sequential: &[f64], concurrent: &[f64]) -> bool {
    if sequential.len() != 6
        || concurrent.len() != 6
        || sequential
            .iter()
            .chain(concurrent)
            .any(|value| !value.is_finite() || *value < 0.0)
    {
        return false;
    }
    let baseline = median(sequential);
    let candidate = median(concurrent);
    candidate >= baseline * 1.2
        && candidate - baseline >= 200.0
        && sequential
            .iter()
            .zip(concurrent)
            .filter(|(a, b)| b > a)
            .count()
            >= 5
}

fn overlap_summary(catalog: usize, arms: &[[OverlapArm; 2]], report: &mut Report) {
    for q in 0..4 {
        let mut paired: [Vec<f64>; 2] = std::array::from_fn(|_| Vec::new());
        for (pair, arms) in arms.iter().enumerate() {
            let warm: Vec<_> = arms
                .iter()
                .map(|arm| {
                    median(
                        &(1..4)
                            .map(|read| arm.samples[read * 4 + q].fetch)
                            .collect::<Vec<_>>(),
                    )
                })
                .collect();
            paired[0].push(warm[0]);
            paired[1].push(warm[1]);
            report.record(
                json!({"kind":"paired-warm","catalog":catalog,"pair":pair,"query":LABELS[q],
                "sequentialRetrievalMedianMs":warm[0],"concurrentRetrievalMedianMs":warm[1]}),
            );
        }
        for first in [true, false] {
            let values: Vec<_> = (0..2)
                .map(|arm| {
                    arms.iter()
                        .flat_map(|pair| {
                            (0..4)
                                .filter(move |read| (*read == 0) == first)
                                .map(move |read| pair[arm].samples[read * 4 + q])
                        })
                        .collect::<Vec<_>>()
                })
                .collect();
            let summaries: Vec<_> = values.iter().map(|samples| {
                let retrieval: Vec<_> = samples.iter().map(|sample| sample.fetch).collect();
                let ipc: Vec<_> = samples.iter().map(|sample| sample.ipc).collect();
                json!({"retrievalMedianMs":median(&retrieval),"retrievalSlowestMs":retrieval.iter().copied().fold(0.0,f64::max),
                    "ipcMedianMs":median(&ipc),"ipcSlowestMs":ipc.iter().copied().fold(0.0,f64::max)})
            }).collect();
            report.record(json!({"kind":"comparison","catalog":catalog,"query":LABELS[q],"read":if first {"first"} else {"warm"},
                "sequential":summaries[0],"concurrent":summaries[1]}));
        }
        let max = arms
            .iter()
            .flat_map(|pair| pair.iter())
            .flat_map(|arm| (0..4).map(move |read| arm.samples[read * 4 + q].fetch))
            .fold(0.0, f64::max);
        report.record(json!({"kind":"decision","catalog":catalog,"query":LABELS[q],"repeatableOverlapPenalty":overlap_penalty(&paired[0],&paired[1]),
            "pairedSequentialWarmMedianMs":median(&paired[0]),"pairedConcurrentWarmMedianMs":median(&paired[1]),
            "slowerPairs":paired[0].iter().zip(&paired[1]).filter(|(a,b)| b>a).count(),
            "slowestRetrievalMs":max,"reached15Seconds":max>=15000.0,"reached19Seconds":max>=19000.0}));
    }
}

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[test]
fn overlap_dispatch_stops_sequential_work_and_synchronizes_concurrent_submission() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    for status in ["query-failed", "result-mismatch"] {
        let calls = AtomicUsize::new(0);
        let result = dispatch_overlap(
            overlap_order(0),
            false,
            |q| {
                calls.fetch_add(1, Ordering::SeqCst);
                q
            },
            |_, _| Err(status),
        );
        assert_eq!(result, Err(status));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
    let entered = AtomicUsize::new(0);
    let rendezvous = std::sync::Barrier::new(4);
    let mut seen = Vec::new();
    dispatch_overlap(
        overlap_order(1),
        true,
        |q| {
            entered.fetch_add(1, Ordering::SeqCst);
            rendezvous.wait();
            assert_eq!(entered.load(Ordering::SeqCst), 4);
            q
        },
        |q, value| {
            assert_eq!(q, value);
            seen.push(q);
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(seen, vec![3, 2, 1, 0]);
    for pair in 0..6 {
        assert_eq!(overlap_order(pair), overlap_order(pair % 2));
    }
}

fn fake_native(launch: &str) -> Vec<Value> {
    let mut records: Vec<_> = (1..=16).map(|id|json!({"kind":"sql-count","callId":id,"launchId":launch,"matched":true,
        "frontend":{"launchId":launch,"callId":id,"label":LABELS[(id-1)%4],"status":"completed","durationMs":120},
        "native":{"callId":id,"label":LABELS[(id-1)%4],"status":"completed","role":"main","operation":"select",
            "startedMs":10.0,"elapsedMs":100.0,"timings":{"registryWaitMs":1.0,"bindMs":1.0,"acquireMs":1.0,"fetchMs":90.0,"decodeMs":1.0}}})).collect();
    records.push(json!({"kind":"sql-trace-summary","launchId":launch,"status":"teardown","detailedAdmitted":16,"matchedOrReported":16,
        "detailedPending":0,"coarsePending":0,"detailedDropped":0,"coarseDropped":0,"frontendDropped":0}));
    records.push(json!({"kind":"summary","launchId":launch,"sqlTraceStorageDropped":0}));
    records
}

#[test]
fn overlap_evidence_rejects_missing_duplicate_foreign_mismatched_and_invalid_timings() {
    let launch = "00000000-0000-4000-8000-000000000001";
    let good = fake_native(launch);
    let mut samples = [OverlapSample {
        ipc: 120.0,
        ..OverlapSample::default()
    }; 16];
    assert!(overlap_native(&good, &mut samples, launch, 16, true));
    assert!(overlap_native(&good[..4], &mut samples, launch, 4, false));
    let mut cases = Vec::new();
    let mut missing = good.clone();
    missing.remove(0);
    cases.push(missing);
    let mut duplicate = good.clone();
    duplicate.push(good[0].clone());
    cases.push(duplicate);
    for pointer in [
        "/launchId",
        "/frontend/launchId",
        "/frontend/label",
        "/native/label",
        "/native/status",
    ] {
        let mut bad = good.clone();
        *bad[0].pointer_mut(pointer).unwrap() = json!("foreign");
        cases.push(bad);
    }
    for (pointer, value) in [
        ("/frontend/callId", json!(2)),
        ("/native/callId", json!(2)),
        ("/frontend/durationMs", json!(121)),
        ("/native/elapsedMs", json!(-1)),
        ("/native/timings/fetchMs", Value::Null),
        ("/native/timings/fetchMs", json!(101)),
        ("/matched", json!(false)),
    ] {
        let mut bad = good.clone();
        *bad[0].pointer_mut(pointer).unwrap() = value;
        cases.push(bad);
    }
    for key in [
        "detailedDropped",
        "coarseDropped",
        "frontendDropped",
        "coarsePending",
        "detailedPending",
    ] {
        let mut bad = good.clone();
        bad[16][key] = json!(1);
        cases.push(bad);
    }
    let mut deadline = good.clone();
    deadline[16]["status"] = json!("deadline");
    cases.push(deadline);
    let mut storage = good.clone();
    storage[17]["sqlTraceStorageDropped"] = json!(1);
    cases.push(storage);
    for bad in cases {
        assert!(!overlap_native(&bad, &mut samples, launch, 16, true));
    }
    assert!(!overlap_native(&good, &mut samples, launch, 17, false));
}

#[test]
fn overlap_gate_requires_absolute_relative_and_paired_penalty() {
    assert!(overlap_penalty(&[1000.; 6], &[1200.; 6]));
    assert!(!overlap_penalty(&[1000.; 6], &[1199.; 6]));
    assert!(!overlap_penalty(&[100.; 6], &[150.; 6]));
    assert!(!overlap_penalty(
        &[1000.; 6],
        &[1200., 1200., 1200., 1200., 900., 900.]
    ));
    assert!(!overlap_penalty(&[1000.; 5], &[1200.; 6]));
    assert!(!overlap_penalty(&[f64::NAN; 6], &[1200.; 6]));
    assert!(!overlap_penalty(&[1000.; 6], &[f64::INFINITY; 6]));
}

#[test]
#[ignore = "explicit post-fix qualification via deadline controller; historical failed gate remains retained"]
fn overlap_generated_arm_evidence_smoke() {
    let id = uuid::Uuid::parse_str(
        &std::env::var("AMBIT_SQL_TRACE_QUALIFICATION_ID").expect("use qualification controller"),
    )
    .unwrap();
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join(format!("startup-sql-qualification-{id}.jsonl"));
    let mut report = Report {
        file: OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap(),
        sequence: 0,
        bytes: 0,
        terminal: false,
    };
    report.record(json!({"kind":"header","schema":1,"evidenceId":id,"qualification":"post-fix-generated-ipc",
        "harnessHash":digest(include_bytes!("startup_sql_overhead.rs")),"vendorHash":vendor_digest(),
        "adapterHash":digest(include_bytes!("../../../startup_sql_trace.rs")),
        "controllerHash":digest(include_bytes!("../../../../../scripts/run-startup-sql-overhead.mjs")),
        "queryLabels":LABELS,"ipcColumns":["catalog","pair","concurrent","read","query","callId","ms","exactResultEqual"],
        "nativeColumns":["catalog","pair","concurrent","read","query","callId","startedMs","totalMs","registryMs","bindMs","acquireMs","retrievalMs","conversionMs"],
        "poolDistributionColumns":["journalMode","synchronous","busyTimeout","cacheSize","tempStore","mmapSize","connections"]}));
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let directory = GeneratedBenchmarkDir::new();
    let template = directory.path.join("template.db");
    seed_wide(&template, 10000, 1000);
    let queries = super::super::count_read_only_probe::generated_trace_queries();
    let expected = {
        let conn = Connection::open(&template).unwrap();
        set_scope(&conn, "all", "", true);
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .unwrap();
        queries
            .iter()
            .map(|query| direct_count_rows(&conn, query))
            .collect::<Vec<_>>()
    };
    let mut round = 0;
    let start = Instant::now();
    let first = overlap_arm(
        &template,
        &queries,
        &expected,
        0,
        0,
        false,
        &mut round,
        start,
        OVERLAP_LIMIT,
        &mut report,
        None,
        false,
    )
    .unwrap_or_else(|status| {
        report.finish(status, start.elapsed());
        panic!("generated arm failed: {status}");
    });
    let second = overlap_arm(
        &template,
        &queries,
        &expected,
        0,
        0,
        true,
        &mut round,
        start,
        OVERLAP_LIMIT,
        &mut report,
        Some(&first.settings),
        false,
    )
    .unwrap_or_else(|status| {
        report.finish(status, start.elapsed());
        let text = std::fs::read_to_string(&path).unwrap();
        for row in text
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .filter(|row| row["kind"] == "trace-incomplete")
        {
            eprintln!("bounded generated trace validation: {row}");
        }
        panic!("generated arm failed: {status}");
    });
    assert_eq!(round, 8);
    assert_eq!(first.settings, second.settings);
    report.finish("completed", start.elapsed());
    drop(report);
    let text = std::fs::read_to_string(&path).unwrap();
    let records: Vec<Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        records.iter().filter(|row| row["kind"] == "ipc").count(),
        32
    );
    assert_eq!(
        records.iter().filter(|row| row["kind"] == "native").count(),
        32
    );
    assert!(records
        .iter()
        .enumerate()
        .all(|(index, row)| row["sequence"] == index));
    assert!(
        !text.contains("collection-000")
            && !text.contains("SELECT")
            && !text.contains("sqlite:")
            && !text.contains("ambit_generated_overlap_lifetime")
    );
}

#[test]
fn overlap_report_full_shape_has_reserved_terminal_capacity_and_partial_status() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("capacity.jsonl");
    let mut report = Report {
        file: OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap(),
        sequence: 0,
        bytes: 0,
        terminal: false,
    };
    // Conservative digit widths beyond the allowed round/arm durations, and ten unique
    // setting groups rather than the usual two. Compact columns preserve all observations.
    let large = 123456789.12345679;
    report.record(json!({"kind":"header","paddingForBoundedProvenance":"x".repeat(8192)}));
    for catalog in 0..2 {
        for pair in 0..6 {
            for concurrent in [false, true] {
                for stage in ["before", "after"] {
                    report.record(json!({"kind":"pool","catalog":catalog,"pair":pair,"concurrent":concurrent,"stage":stage,
                "openingMs":large,"distribution":vec![json!(["wal",2,60000,-64000,2,268435456,1]);10],
                "preparationMs":large,"untreatedDistribution":vec![json!(["wal",2,60000,-64000,2,268435456,1]);10],
                "markerPolicy":"unused-collation-lifetime-v1","stable":true,"closedOriginals":0,"markerCalls":0}));
                }
                for read in 0..4 {
                    for q in 0..4 {
                        report.record(json!({"kind":"ipc","data":[catalog,pair,concurrent,read,q,read*4+q+1,large,true]}));
                        report.record(json!({"kind":"native","data":[catalog,pair,concurrent,read,q,read*4+q+1,large,large,large,large,large,large,large]}));
                    }
                    report.record(json!({"kind":"overlap","catalog":catalog,"pair":pair,"concurrent":concurrent,"read":read,
                "nativePairOverlapMs":vec![large;6],"pairOrder":"01-02-03-12-13-23"}));
                }
            }
            report
                .record(json!({"kind":"pair-settings","catalog":catalog,"pair":pair,"equal":true}));
        }
        let pairs: Vec<_> = (0..6)
            .map(|_| {
                std::array::from_fn(|_| OverlapArm {
                    samples: [OverlapSample {
                        ipc: large,
                        fetch: large,
                        ..OverlapSample::default()
                    }; 16],
                    settings: Vec::new(),
                })
            })
            .collect();
        overlap_summary(catalog, &pairs, &mut report);
    }
    report.finish("completed", Duration::from_secs(1800));
    assert!(report.bytes < 248 * 1024);
    drop(report);
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.len() < 256 * 1024);
    assert_eq!(
        text.lines()
            .filter(|line| line.contains("\"kind\":\"terminal\""))
            .count(),
        1
    );
    let partial = directory.path.join("partial.jsonl");
    {
        let mut report = Report {
            file: OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&partial)
                .unwrap(),
            sequence: 0,
            bytes: 0,
            terminal: false,
        };
        report.record(json!({"kind":"header"}));
    }
    assert!(std::fs::read_to_string(partial)
        .unwrap()
        .contains("\"status\":\"interrupted\""));
}

fn vendor_digest() -> String {
    fn files(root: &Path, paths: &mut Vec<std::path::PathBuf>) {
        for entry in std::fs::read_dir(root).unwrap() {
            let entry = entry.unwrap();
            let kind = entry.file_type().unwrap();
            assert!(!kind.is_symlink(), "vendor provenance rejects redirection");
            if kind.is_dir() {
                files(&entry.path(), paths);
            } else {
                assert!(kind.is_file());
                paths.push(entry.path());
            }
        }
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("vendor/tauri-plugin-sql");
    let mut paths = Vec::new();
    files(&root, &mut paths);
    paths.sort();
    let mut hasher = Sha256::new();
    for path in paths {
        hasher.update(
            path.strip_prefix(&root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/"),
        );
        hasher.update([0]);
        hasher.update(std::fs::read(path).unwrap());
        hasher.update([0]);
    }
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[test]
#[ignore = "one approved generated-only overlap campaign; controller opt-in and deadlines required"]
fn measure_startup_sql_overlap_once() {
    assert_eq!(std::env::var("AMBIT_SQL_TRACE_OVERLAP").as_deref(), Ok("1"));
    run_overlap_campaign(false);
}

#[test]
#[ignore = "one approved uniform-default generated overlap campaign; explicit controller required"]
fn measure_startup_sql_uniform_overlap_once() {
    assert_eq!(
        std::env::var("AMBIT_SQL_TRACE_UNIFORM_OVERLAP").as_deref(),
        Ok("1")
    );
    run_overlap_campaign(true);
}

fn run_overlap_campaign(uniform_defaults: bool) {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let id = uuid::Uuid::parse_str(
        &std::env::var(if uniform_defaults {
            "AMBIT_SQL_TRACE_UNIFORM_OVERLAP_ID"
        } else {
            "AMBIT_SQL_TRACE_OVERLAP_ID"
        })
        .expect("use deadline controller"),
    )
    .unwrap();
    let prefix = if uniform_defaults {
        "uniform-overlap"
    } else {
        "overlap"
    };
    let artifact = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join(format!("startup-sql-{prefix}-{id}.jsonl"));
    let mut report = Report {
        file: OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(artifact)
            .unwrap(),
        sequence: 0,
        bytes: 0,
        terminal: false,
    };
    let campaign = Instant::now();
    let queries = super::super::count_read_only_probe::generated_trace_queries();
    let revision = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .unwrap();
    let revision = String::from_utf8(revision.stdout).unwrap();
    assert!(revision.trim().len() == 40 && revision.trim().bytes().all(|b| b.is_ascii_hexdigit()));
    report.record(json!({"kind":"header","schema":1,"evidenceId":id,"revision":revision.trim(),"pairs":6,"firstReads":1,"warmReads":3,
        "poolTreatment":if uniform_defaults { "all-ten-observed-defaults-wal-v1" } else { "unchanged-frontend-pragmas" },
        "catalogs":[{"images":10000,"memberships":1000},{"images":146182,"memberships":131741}],
        "queryHashes":queries.iter().map(|query|digest(query.as_bytes())).collect::<Vec<_>>(),
        "fixtureSourceHash":digest(include_bytes!("count_index_benchmark.rs")),"catalogSourceHash":digest(include_bytes!("../collection_stats_query_tests.rs")),
        "harnessHash":digest(include_bytes!("startup_sql_overhead.rs")),"controllerHash":digest(include_bytes!("../../../../../scripts/run-startup-sql-overhead.mjs")),
        "setupSourceHash":digest(include_bytes!("../sql_plugin_tests.rs")),"pluginVersion":"2.4.0","vendorHash":vendor_digest(),
        "adapterSourceHash":digest(include_bytes!("../../../startup_sql_trace.rs")),"journalSourceHash":digest(include_bytes!("../../../startup_log.rs")),
        "vendorHashPolicy":"sorted-relative-path-NUL-bytes-NUL-sha256",
        "markerPolicy":"unused-collation-lifetime-v1","boundary":"generated IPC; retrieval includes worker scheduling locking execution and transfer; not OS-cold or startup acceptance",
        "queryLabels":LABELS,"ipcColumns":["catalog","pair","concurrent","read","query","callId","ms","exactResultEqual"],
        "nativeColumns":["catalog","pair","concurrent","read","query","callId","startedMs","totalMs","registryMs","bindMs","acquireMs","retrievalMs","conversionMs"],
        "poolDistributionColumns":["journalMode","synchronous","busyTimeout","cacheSize","tempStore","mmapSize","connections"],
        "poolObservation":"before-after distributions; no per-query connection assignment; marker callbacks must remain zero"}));
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
        || -> Result<(), &'static str> {
            let directory = GeneratedBenchmarkDir::new();
            let mut round = 0;
            for (catalog, (images, memberships)) in
                [(10000, 1000), (146182, 131741)].into_iter().enumerate()
            {
                if campaign.elapsed() >= OVERLAP_LIMIT {
                    return Err("timed-out");
                }
                let template = directory.path.join(format!("template-{catalog}.db"));
                seed_wide(&template, images, memberships);
                let expected = {
                    let conn = Connection::open(&template).unwrap();
                    set_scope(&conn, "all", "", true);
                    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
                        .unwrap();
                    queries
                        .iter()
                        .map(|query| direct_count_rows(&conn, query))
                        .collect::<Vec<_>>()
                };
                let mut pairs = Vec::new();
                for pair in 0..6 {
                    let mut arms: [Option<OverlapArm>; 2] = [None, None];
                    for concurrent in if pair % 2 == 0 {
                        [false, true]
                    } else {
                        [true, false]
                    } {
                        if campaign.elapsed() >= OVERLAP_LIMIT {
                            return Err("timed-out");
                        }
                        let paired_settings = arms[usize::from(!concurrent)]
                            .as_ref()
                            .map(|arm| arm.settings.as_slice());
                        let arm = overlap_arm(
                            &template,
                            &queries,
                            &expected,
                            catalog,
                            pair,
                            concurrent,
                            &mut round,
                            campaign,
                            OVERLAP_LIMIT,
                            &mut report,
                            paired_settings,
                            uniform_defaults,
                        )?;
                        if arms[usize::from(!concurrent)]
                            .as_ref()
                            .is_some_and(|other| other.settings != arm.settings)
                        {
                            report.record(json!({"kind":"pair-settings","catalog":catalog,"pair":pair,"equal":false}));
                            return Err("invalid-comparison");
                        }
                        arms[usize::from(concurrent)] = Some(arm);
                    }
                    report.record(
                        json!({"kind":"pair-settings","catalog":catalog,"pair":pair,"equal":true}),
                    );
                    pairs.push(arms.map(Option::unwrap));
                }
                overlap_summary(catalog, &pairs, &mut report);
            }
            assert_eq!(round, 96);
            Ok(())
        },
    ));
    let status = match outcome {
        Ok(Ok(())) => "completed",
        Ok(Err(status)) => status,
        Err(_) => "failed",
    };
    report.finish(status, campaign.elapsed());
    assert_eq!(
        status, "completed",
        "partial overlap evidence ends branch; no timing-driven reruns"
    );
}

const OWNERSHIP_LIMIT: Duration = Duration::from_secs(60 * 60);

fn overlap_deadline_expired(round: Duration, campaign: Duration, limit: Duration) -> bool {
    round >= Duration::from_secs(60) || campaign >= limit
}

#[test]
fn ownership_campaign_budget_is_one_hour() {
    assert_eq!(OWNERSHIP_LIMIT.as_millis(), 3_600_000);
    assert!(
        include_str!("../../../../../scripts/run-startup-sql-overhead.mjs")
            .contains("const OWNERSHIP_BUDGET_MS = 3600000;")
    );
    assert!(!overlap_deadline_expired(
        Duration::from_millis(59_999),
        OWNERSHIP_LIMIT - Duration::from_millis(1),
        OWNERSHIP_LIMIT,
    ));
    assert!(overlap_deadline_expired(
        Duration::ZERO,
        OWNERSHIP_LIMIT,
        OWNERSHIP_LIMIT,
    ));
    assert!(overlap_deadline_expired(
        Duration::from_secs(60),
        Duration::ZERO,
        OWNERSHIP_LIMIT,
    ));
}

const OWNERSHIP_ORDER: [usize; 6] = [0, 1, 5, 2, 4, 3];
const OWNERSHIP_BYPASS_SQL: &str = "DROP VIEW IF EXISTS scoped_images;
    DROP VIEW IF EXISTS scoped_removed_images;
    DROP VIEW IF EXISTS scoped_collections;
    CREATE VIEW scoped_images AS SELECT i.rowid AS rowid, i.* FROM images i;
    CREATE VIEW scoped_removed_images AS SELECT i.rowid AS rowid, i.* FROM removed_images i;
    CREATE VIEW scoped_collections AS
        SELECT c.rowid AS rowid, c.* FROM collections c WHERE c.invoke_suppressed = 0;";

#[derive(Clone, Copy)]
struct OwnershipCondition {
    label: &'static str,
    invoke: bool,
    selected_owner: bool,
    bypass: bool,
}

const OWNERSHIP_CONDITIONS: [OwnershipCondition; 6] = [
    OwnershipCondition {
        label: "local-shipping",
        invoke: false,
        selected_owner: false,
        bypass: false,
    },
    OwnershipCondition {
        label: "local-bypass",
        invoke: false,
        selected_owner: false,
        bypass: true,
    },
    OwnershipCondition {
        label: "invoke-all-shipping",
        invoke: true,
        selected_owner: false,
        bypass: false,
    },
    OwnershipCondition {
        label: "invoke-all-bypass",
        invoke: true,
        selected_owner: false,
        bypass: true,
    },
    OwnershipCondition {
        label: "invoke-selected-shipping",
        invoke: true,
        selected_owner: true,
        bypass: false,
    },
    OwnershipCondition {
        label: "invoke-selected-bypass",
        invoke: true,
        selected_owner: true,
        bypass: true,
    },
];

#[derive(Clone)]
struct OwnershipFixture {
    path: std::path::PathBuf,
    bytes: u64,
    source_rows: i64,
}

fn ownership_order(block: usize) -> [usize; 6] {
    std::array::from_fn(|index| (OWNERSHIP_ORDER[index] + block) % OWNERSHIP_CONDITIONS.len())
}

fn ownership_generated_path(directory: &Path, path: &Path) -> bool {
    let raw_root = match std::fs::symlink_metadata(directory) {
        Ok(metadata) => metadata,
        Err(_) => return false,
    };
    if raw_root.file_type().is_symlink() || !raw_root.is_dir() {
        return false;
    }
    #[cfg(windows)]
    if {
        use std::os::windows::fs::MetadataExt;
        raw_root.file_attributes() & 0x400 != 0
    } {
        return false;
    }
    let Ok(root) = directory.canonicalize() else {
        return false;
    };
    let Ok(candidate) = path.canonicalize() else {
        return false;
    };
    if root.parent() != std::env::temp_dir().canonicalize().ok().as_deref()
        || candidate.parent() != Some(root.as_path())
        || !candidate.is_file()
    {
        return false;
    }
    let root_metadata = match std::fs::symlink_metadata(&root) {
        Ok(metadata) => metadata,
        Err(_) => return false,
    };
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return false;
    }
    #[cfg(windows)]
    if {
        use std::os::windows::fs::MetadataExt;
        root_metadata.file_attributes() & 0x400 != 0
    } {
        return false;
    }
    let allowed = [
        candidate.file_name().unwrap().to_owned(),
        std::ffi::OsString::from(format!(
            "{}-wal",
            candidate.file_name().unwrap().to_string_lossy()
        )),
        std::ffi::OsString::from(format!(
            "{}-shm",
            candidate.file_name().unwrap().to_string_lossy()
        )),
    ];
    let regular = |candidate: &Path| {
        std::fs::symlink_metadata(candidate)
            .ok()
            .is_some_and(|metadata| {
                if metadata.file_type().is_symlink() {
                    return false;
                }
                #[cfg(windows)]
                if {
                    use std::os::windows::fs::MetadataExt;
                    metadata.file_attributes() & 0x400 != 0
                } {
                    return false;
                }
                metadata.is_file()
            })
    };
    std::fs::read_dir(&root).ok().is_some_and(|entries| {
        entries.flatten().all(|entry| {
            allowed.iter().any(|name| entry.file_name() == *name) && regular(&entry.path())
        })
    })
}

fn ownership_view_columns(conn: &Connection) -> Vec<Vec<String>> {
    ownership_view_columns_checked(conn).expect("generated view columns")
}

fn ownership_view_columns_checked(conn: &Connection) -> rusqlite::Result<Vec<Vec<String>>> {
    [
        "scoped_images",
        "scoped_removed_images",
        "scoped_collections",
    ]
    .iter()
    .map(|view| {
        let mut statement = conn.prepare(&format!("PRAGMA table_info({view})"))?;
        let rows = statement
            .query_map([], |row| row.get(1))?
            .collect::<rusqlite::Result<Vec<String>>>();
        rows
    })
    .collect()
}

#[derive(Debug)]
struct FixtureCheckFailure {
    status: &'static str,
    sqlite: bool,
    code: Option<i32>,
}
impl FixtureCheckFailure {
    fn sqlite(status: &'static str, error: rusqlite::Error) -> Self {
        let code = preparation_sqlite_code(&error);
        Self {
            status,
            sqlite: true,
            code,
        }
    }
    fn diagnosed(self, prep: &OwnershipPreparation<'_>) -> OwnershipPreparationFailure {
        let mut failure = prep.validation_failure().with_legacy_status(self.status);
        if self.sqlite {
            failure.category = PreparationCategory::Sqlite;
            failure.sqlite_code = self.code;
        }
        failure
    }
}
impl From<&'static str> for FixtureCheckFailure {
    fn from(status: &'static str) -> Self {
        Self {
            status,
            sqlite: false,
            code: None,
        }
    }
}

fn validate_ownership_fixture(
    directory: &GeneratedBenchmarkDir,
    path: &Path,
    images: usize,
    memberships: usize,
    condition: OwnershipCondition,
) -> Result<i64, &'static str> {
    validate_ownership_fixture_checked(directory, path, images, memberships, condition)
        .map_err(|failure| failure.status)
}

fn validate_ownership_fixture_checked(
    directory: &GeneratedBenchmarkDir,
    path: &Path,
    images: usize,
    memberships: usize,
    condition: OwnershipCondition,
) -> Result<i64, FixtureCheckFailure> {
    if !ownership_generated_path(&directory.path, path) {
        return Err("invalid-generated-fixture".into());
    }
    let conn = Connection::open(path)
        .map_err(|error| FixtureCheckFailure::sqlite("invalid-generated-fixture", error))?;
    let (image_count, membership_count, min_id, max_id, source_rows, owner_rows): (
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
    ) = conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM images), (SELECT COUNT(*) FROM collection_images),
            (SELECT MIN(LENGTH(id)) FROM images), (SELECT MAX(LENGTH(id)) FROM images),
            (SELECT COUNT(*) FROM images WHERE invoke_source_id IS NOT NULL),
            (SELECT COUNT(*) FROM images WHERE invoke_owner_id IS NOT NULL)",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .map_err(|error| FixtureCheckFailure::sqlite("invalid-generated-fixture", error))?;
    if image_count != images as i64
        || membership_count != memberships as i64
        || min_id != 80
        || max_id != 80
    {
        return Err("invalid-generated-fixture".into());
    }
    let expected_source_rows = if condition.invoke { images as i64 } else { 0 };
    if source_rows != expected_source_rows || owner_rows != expected_source_rows {
        return Err("invalid-generated-fixture".into());
    }
    let wrong_identity: i64 = conn.query_row(
        if condition.invoke {
            "SELECT COUNT(*) FROM images WHERE invoke_source_id != 'fixture.db' OR invoke_owner_id != 'generated-owner'"
        } else {
            "SELECT COUNT(*) FROM images WHERE invoke_source_id IS NOT NULL OR invoke_owner_id IS NOT NULL"
        },
        [], |row| row.get(0),
    ).map_err(|error| FixtureCheckFailure::sqlite("invalid-generated-fixture", error))?;
    if wrong_identity != 0 {
        return Err("invalid-generated-fixture".into());
    }
    let nonlocal_collections: i64 = conn.query_row(
        "SELECT COUNT(*) FROM collections WHERE invoke_source_id IS NOT NULL OR invoke_owner_id IS NOT NULL",
        [], |row| row.get(0),
    ).map_err(|error| FixtureCheckFailure::sqlite("invalid-generated-fixture", error))?;
    if nonlocal_collections != 0 {
        return Err("invalid-generated-fixture".into());
    }
    let scope: Option<(String, Option<String>, String, i64)> = conn.query_row(
        "SELECT scope_mode, owner_id, db_path, boards_verified FROM invoke_owner_scope_state WHERE state_key='current'",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).optional().map_err(|error| FixtureCheckFailure::sqlite("invalid-generated-fixture", error))?;
    match (condition.invoke, condition.selected_owner, scope) {
        (false, _, None) => (),
        (true, false, Some((mode, None, source, verified)))
            if mode == "all" && source == "fixture.db" && verified == 1 =>
        {
            ()
        }
        (true, true, Some((mode, Some(owner), source, verified)))
            if mode == "owner"
                && owner == "generated-owner"
                && source == "fixture.db"
                && verified == 1 =>
        {
            ()
        }
        _ => return Err("invalid-generated-fixture".into()),
    }
    Ok(source_rows)
}

// This is intentionally destructive only to a verified disposable generated file.
// It is not callable from the application and does not model owner isolation.
fn install_ownership_bypass(
    directory: &GeneratedBenchmarkDir,
    path: &Path,
    images: usize,
    memberships: usize,
    condition: OwnershipCondition,
) -> Result<(), &'static str> {
    install_ownership_bypass_checked(directory, path, images, memberships, condition)
        .map_err(|failure| failure.status)
}

fn install_ownership_bypass_checked(
    directory: &GeneratedBenchmarkDir,
    path: &Path,
    images: usize,
    memberships: usize,
    condition: OwnershipCondition,
) -> Result<(), FixtureCheckFailure> {
    validate_ownership_fixture_checked(directory, path, images, memberships, condition)?;
    let conn = Connection::open(path)
        .map_err(|error| FixtureCheckFailure::sqlite("invalid-generated-fixture", error))?;
    let shipping_columns = ownership_view_columns_checked(&conn)
        .map_err(|error| FixtureCheckFailure::sqlite("bypass-install-failed", error))?;
    conn.execute_batch(OWNERSHIP_BYPASS_SQL)
        .map_err(|error| FixtureCheckFailure::sqlite("bypass-install-failed", error))?;
    if ownership_view_columns_checked(&conn)
        .map_err(|error| FixtureCheckFailure::sqlite("bypass-install-failed", error))?
        != shipping_columns
    {
        return Err("bypass-column-mismatch".into());
    }
    Ok(())
}

fn ownership_rows(conn: &Connection, queries: &[String; 4]) -> Vec<Vec<Value>> {
    ownership_rows_checked(conn, queries).expect("generated ownership count rows")
}

fn ownership_rows_checked(
    conn: &Connection,
    queries: &[String; 4],
) -> rusqlite::Result<Vec<Vec<Value>>> {
    queries
        .iter()
        .map(|query| super::super::direct_count_rows_checked(conn, query))
        .collect()
}

fn ownership_content_hash(conn: &Connection) -> String {
    ownership_content_hash_checked(conn).expect("generated ownership content hash")
}

fn ownership_content_hash_checked(conn: &Connection) -> rusqlite::Result<String> {
    let mut hasher = Sha256::new();
    for (table, excluded, order) in [
        (
            "images",
            &["invoke_source_id", "invoke_owner_id"][..],
            "rowid",
        ),
        (
            "removed_images",
            &["invoke_source_id", "invoke_owner_id"][..],
            "rowid",
        ),
        ("collections", &[][..], "rowid"),
        ("collection_images", &[][..], "collection_id, image_id"),
    ] {
        let mut names = conn
            .prepare(&format!("PRAGMA table_info({table})"))?
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;
        names.retain(|name| !excluded.contains(&name.as_str()));
        hasher.update(table.as_bytes());
        hasher.update([0]);
        for name in &names {
            hasher.update(name.as_bytes());
            hasher.update([0]);
        }
        let columns = names
            .iter()
            .map(|name| format!("\"{}\"", name.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(",");
        let mut statement =
            conn.prepare(&format!("SELECT {columns} FROM {table} ORDER BY {order}"))?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            for index in 0..names.len() {
                match row.get_ref(index)? {
                    ValueRef::Null => {
                        hasher.update([0]);
                        hasher.update(0_u64.to_le_bytes());
                    }
                    ValueRef::Integer(value) => {
                        hasher.update([1]);
                        hasher.update((std::mem::size_of_val(&value) as u64).to_le_bytes());
                        hasher.update(value.to_le_bytes());
                    }
                    ValueRef::Real(value) => {
                        hasher.update([2]);
                        hasher.update((std::mem::size_of_val(&value) as u64).to_le_bytes());
                        hasher.update(value.to_bits().to_le_bytes());
                    }
                    ValueRef::Text(value) => {
                        hasher.update([3]);
                        hasher.update((value.len() as u64).to_le_bytes());
                        hasher.update(value);
                    }
                    ValueRef::Blob(value) => {
                        hasher.update([4]);
                        hasher.update((value.len() as u64).to_le_bytes());
                        hasher.update(value);
                    }
                }
            }
            hasher.update([0xff]);
        }
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn ownership_fixture(
    directory: &GeneratedBenchmarkDir,
    base: &Path,
    index: usize,
    images: usize,
    memberships: usize,
    queries: &[String; 4],
    expected: &[Vec<Value>],
    expected_content_hash: &str,
) -> Result<OwnershipFixture, &'static str> {
    let mut preparation = OwnershipPreparation {
        report: None,
        campaign: Instant::now(),
        condition: None,
        block: None,
        last_stage: None,
        next_fixture_id: 0,
    };
    ownership_fixture_diagnosed(
        directory,
        base,
        index,
        images,
        memberships,
        queries,
        expected,
        expected_content_hash,
        &mut preparation,
    )
    .map_err(|failure| failure.legacy_status())
}

fn ownership_fixture_diagnosed(
    directory: &GeneratedBenchmarkDir,
    base: &Path,
    index: usize,
    images: usize,
    memberships: usize,
    queries: &[String; 4],
    expected: &[Vec<Value>],
    expected_content_hash: &str,
    preparation: &mut OwnershipPreparation<'_>,
) -> Result<OwnershipFixture, OwnershipPreparationFailure> {
    let condition = OWNERSHIP_CONDITIONS[index];
    let path = directory.path.join(format!("ownership-{index}.db"));
    preparation.enter(PreparationStage::FixtureCopy);
    std::fs::copy(base, &path).map_err(|error| {
        preparation
            .os_failure(&error)
            .with_legacy_status("fixture-copy-failed")
    })?;
    {
        preparation.enter(PreparationStage::ConnectionOpening);
        let conn = Connection::open(&path).map_err(|error| {
            preparation
                .sqlite_failure(&error)
                .with_legacy_status("fixture-copy-failed")
        })?;
        preparation.enter(PreparationStage::OwnershipAssignment);
        if condition.invoke {
            conn.execute("UPDATE images SET invoke_source_id='fixture.db', invoke_owner_id='generated-owner'", [])
                .map_err(|error| preparation.sqlite_failure(&error))?;
            preparation.enter(PreparationStage::ScopeSetup);
            ownership_scope(&conn, condition.selected_owner)
                .map_err(|error| preparation.sqlite_failure(&error))?;
        } else {
            conn.execute(
                "UPDATE images SET invoke_source_id=NULL, invoke_owner_id=NULL",
                [],
            )
            .map_err(|error| preparation.sqlite_failure(&error))?;
            preparation.enter(PreparationStage::ScopeSetup);
            conn.execute("DELETE FROM invoke_owner_scope_state", [])
                .map_err(|error| preparation.sqlite_failure(&error))?;
        }
    }
    preparation.enter(PreparationStage::FixtureValidation);
    let source_rows =
        validate_ownership_fixture_checked(directory, &path, images, memberships, condition)
            .map_err(|failure| failure.diagnosed(preparation))?;
    if condition.bypass {
        preparation.enter(PreparationStage::BypassInstallation);
        install_ownership_bypass_checked(directory, &path, images, memberships, condition)
            .map_err(|failure| failure.diagnosed(preparation))?;
    }
    preparation.enter(PreparationStage::ConnectionOpening);
    let conn = Connection::open(&path).map_err(|error| preparation.sqlite_failure(&error))?;
    preparation.enter(PreparationStage::Analysis);
    conn.execute_batch("ANALYZE;")
        .map_err(|error| preparation.sqlite_failure(&error))?;
    preparation.enter(PreparationStage::Checkpointing);
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|error| preparation.sqlite_failure(&error))?;
    preparation.enter(PreparationStage::EqualityCheck);
    if ownership_content_hash_checked(&conn).map_err(|error| preparation.sqlite_failure(&error))?
        != expected_content_hash
    {
        return Err(preparation
            .validation_failure()
            .with_legacy_status("fixture-content-mismatch"));
    }
    if ownership_rows_checked(&conn, queries).map_err(|error| preparation.sqlite_failure(&error))?
        != expected
    {
        return Err(preparation
            .validation_failure()
            .with_legacy_status("result-mismatch"));
    }
    preparation.enter(PreparationStage::FileSizeInspection);
    let bytes = std::fs::metadata(&path)
        .map_err(|error| preparation.os_failure(&error))?
        .len();
    Ok(OwnershipFixture {
        path,
        bytes,
        source_rows,
    })
}

// Keep one guarded generated catalog per condition alive while the approved
// ownership campaign copies from those validated templates. Each directory
// contains its single template database; measured arms create their own fresh
// guarded copy through ownership_arm.
fn with_prepared_ownership_templates<T>(
    preparation: &mut OwnershipPreparation<'_>,
    base: &Path,
    images: usize,
    memberships: usize,
    queries: &[String; 4],
    expected: &[Vec<Value>],
    expected_content_hash: &str,
    next_template: usize,
    templates: &mut [Option<OwnershipFixture>; 6],
    work: impl FnOnce(
        &[Option<OwnershipFixture>; 6],
        &mut OwnershipPreparation<'_>,
    ) -> Result<T, OwnershipCampaignFailure>,
) -> Result<T, OwnershipCampaignFailure> {
    if preparation.campaign.elapsed() >= OWNERSHIP_LIMIT {
        return Err("timed-out".into());
    }
    if next_template == OWNERSHIP_ORDER.len() {
        return work(templates, preparation);
    }

    let condition = OWNERSHIP_ORDER[next_template];
    preparation.condition = Some(OWNERSHIP_CONDITIONS[condition].label);
    preparation.block = Some(0);
    let result = preparation.with_directory(|directory, preparation| {
        let fixture = ownership_fixture_diagnosed(
            directory,
            base,
            condition,
            images,
            memberships,
            queries,
            expected,
            expected_content_hash,
            preparation,
        )?;
        preparation.record(json!({
            "kind":"template-prepared",
            "condition":OWNERSHIP_CONDITIONS[condition].label,
            "templateIndex":condition,
            "bytes":fixture.bytes,
            "sourceRows":fixture.source_rows,
            "exactResultEqual":true
        }));
        templates[condition] = Some(fixture);
        if preparation.campaign.elapsed() >= OWNERSHIP_LIMIT {
            return Err("timed-out".into());
        }
        with_prepared_ownership_templates(
            preparation,
            base,
            images,
            memberships,
            queries,
            expected,
            expected_content_hash,
            next_template + 1,
            templates,
            work,
        )
    });
    templates[condition] = None;
    result
}

// Same DELETE/INSERT and parameters as set_scope, but retain SQLite's code here.
fn ownership_scope(conn: &Connection, selected: bool) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM invoke_owner_scope_state", [])?;
    conn.execute(
        "INSERT INTO invoke_owner_scope_state
            (state_key, db_path, images_root, scope_mode, owner_id, updated_at, boards_verified)
            VALUES ('current', 'fixture.db', 'C:/SyntheticSource', ?1, ?2, 1, ?3)",
        rusqlite::params![
            if selected { "owner" } else { "all" },
            if selected {
                Some("generated-owner")
            } else {
                None
            },
            1i64
        ],
    )?;
    Ok(())
}

#[derive(Debug)]
enum OwnershipCampaignFailure {
    Terminal(&'static str),
    Preparation(OwnershipPreparationFailure),
}
impl OwnershipCampaignFailure {
    fn status(&self) -> &'static str {
        match self {
            Self::Terminal(status) => status,
            Self::Preparation(failure) => failure.legacy_status(),
        }
    }
    fn preparation_failure(&self) -> Option<OwnershipPreparationFailure> {
        match self {
            Self::Terminal(_) => None,
            Self::Preparation(failure) => Some(*failure),
        }
    }
}
impl From<&'static str> for OwnershipCampaignFailure {
    fn from(status: &'static str) -> Self {
        Self::Terminal(status)
    }
}
impl From<OwnershipPreparationFailure> for OwnershipCampaignFailure {
    fn from(failure: OwnershipPreparationFailure) -> Self {
        Self::Preparation(failure)
    }
}

fn ownership_span(arm: &OverlapArm, read: usize) -> f64 {
    let samples = &arm.samples[read * 4..read * 4 + 4];
    let first = samples
        .iter()
        .map(|sample| sample.started)
        .fold(f64::INFINITY, f64::min);
    let last = samples
        .iter()
        .map(|sample| sample.started + sample.native)
        .fold(0.0, f64::max);
    (last - first).max(0.0)
}

fn ownership_arm(
    fixture: &OwnershipFixture,
    queries: &[String; 4],
    expected: &[Vec<Value>],
    condition: usize,
    block: usize,
    concurrent: bool,
    round: &mut usize,
    campaign: Instant,
    preparation: &mut OwnershipPreparation<'_>,
    paired_settings: Option<&[Value]>,
) -> Result<OverlapArm, OwnershipCampaignFailure> {
    preparation.with_directory(|directory, preparation| {
        preparation.enter(PreparationStage::FixtureCopy);
        if !fixture.path.parent().is_some_and(|template_directory| {
            ownership_generated_path(template_directory, &fixture.path)
        }) {
            return Err(preparation
                .validation_failure()
                .with_legacy_status("invalid-generated-fixture")
                .into());
        }
        std::fs::copy(&fixture.path, directory.path.join("overlap.db"))
            .map_err(|error| preparation.os_failure(&error).with_legacy_status("failed"))?;
        preparation.enter(PreparationStage::ConnectionOpening);
        let arm = overlap_arm_in(
            directory,
            queries,
            expected,
            condition,
            block,
            concurrent,
            round,
            campaign,
            OWNERSHIP_LIMIT,
            preparation,
            paired_settings,
            true,
        )?;
        for read in 0..4 {
            preparation.record(
                json!({"kind":"native-group-span","condition":OWNERSHIP_CONDITIONS[condition].label,
            "block":block,"boundary":if concurrent {"concurrent"} else {"sequential"},
            "read":read,"nativeSpanMs":ownership_span(&arm, read)}),
            );
        }
        Ok(arm)
    })
}

fn ownership_material(baseline: &[f64], candidate: &[f64]) -> bool {
    overlap_penalty(baseline, candidate)
}

fn ownership_comparison<E: Evidence>(
    report: &mut E,
    comparison: &str,
    baseline: usize,
    candidate: usize,
    boundary: usize,
    matrix: &[Vec<[OverlapArm; 2]>],
) {
    for query in 0..4 {
        let values = |condition: usize| -> Vec<f64> {
            matrix[condition]
                .iter()
                .map(|arms| {
                    median(
                        &(1..4)
                            .map(|read| arms[boundary].samples[read * 4 + query].fetch)
                            .collect::<Vec<_>>(),
                    )
                })
                .collect()
        };
        let baseline_values = values(baseline);
        let candidate_values = values(candidate);
        let baseline_median = median(&baseline_values);
        let candidate_median = median(&candidate_values);
        report.record(json!({"kind":"ownership-comparison","comparison":comparison,"query":LABELS[query],
            "boundary":if boundary == 0 {"sequential"} else {"concurrent"},
            "baseline":OWNERSHIP_CONDITIONS[baseline].label,"candidate":OWNERSHIP_CONDITIONS[candidate].label,
            "baselineBlockWarmMs":baseline_values,"candidateBlockWarmMs":candidate_values,
            "baselineMedianMs":baseline_median,"candidateMedianMs":candidate_median,
            "absoluteMs":candidate_median-baseline_median,
            "percent":if baseline_median == 0.0 { Value::Null } else { json!((candidate_median-baseline_median)*100.0/baseline_median) },
            "sameDirectionBlocks":baseline_values.iter().zip(&candidate_values).filter(|(a,b)| b > a).count(),
            "repeatableMaterialPenalty":ownership_material(&baseline_values, &candidate_values)}));
    }
}

fn ownership_summary<E: Evidence>(matrix: &[Vec<[OverlapArm; 2]>], report: &mut E) {
    for (condition, blocks) in matrix.iter().enumerate() {
        for boundary in 0..2 {
            for query in 0..4 {
                let first: Vec<_> = blocks
                    .iter()
                    .map(|arms| arms[boundary].samples[query].fetch)
                    .collect();
                let warm: Vec<_> = blocks
                    .iter()
                    .map(|arms| {
                        median(
                            &(1..4)
                                .map(|read| arms[boundary].samples[read * 4 + query].fetch)
                                .collect::<Vec<_>>(),
                        )
                    })
                    .collect();
                let first_spans: Vec<_> = blocks
                    .iter()
                    .map(|arms| ownership_span(&arms[boundary], 0))
                    .collect();
                let warm_spans: Vec<_> = blocks
                    .iter()
                    .map(|arms| {
                        median(
                            &(1..4)
                                .map(|read| ownership_span(&arms[boundary], read))
                                .collect::<Vec<_>>(),
                        )
                    })
                    .collect();
                let slowest = blocks
                    .iter()
                    .flat_map(|arms| {
                        (0..4).map(move |read| arms[boundary].samples[read * 4 + query].fetch)
                    })
                    .fold(0.0, f64::max);
                report.record(json!({"kind":"ownership-summary","condition":OWNERSHIP_CONDITIONS[condition].label,
                    "boundary":if boundary == 0 {"sequential"} else {"concurrent"},"query":LABELS[query],
                    "firstMs":first,"firstMedianMs":median(&first),"warmBlockMedianMs":warm,
                    "warmMedianMs":median(&warm),"slowestMs":slowest,
                    "firstNativeGroupSpanMs":first_spans,"firstNativeGroupSpanMedianMs":median(&first_spans),
                    "warmNativeGroupSpanBlockMedianMs":warm_spans,"warmNativeGroupSpanMedianMs":median(&warm_spans)}));
            }
        }
    }
    for boundary in 0..2 {
        for (comparison, baseline, candidate) in [
            ("shipping-vs-bypass", 1, 0),
            ("shipping-vs-bypass", 3, 2),
            ("shipping-vs-bypass", 5, 4),
            ("all-users-vs-local", 0, 2),
            ("selected-owner-vs-all-users", 2, 4),
        ] {
            ownership_comparison(report, comparison, baseline, candidate, boundary, matrix);
        }
    }
}

fn ownership_small_base(
    directory: &GeneratedBenchmarkDir,
) -> (std::path::PathBuf, [String; 4], Vec<Vec<Value>>, String) {
    let base = directory.path.join("ownership-small-base.db");
    seed_wide(&base, 10_000, 1_000);
    let conn = Connection::open(&base).unwrap();
    conn.execute(
        "UPDATE images SET invoke_source_id=NULL, invoke_owner_id=NULL",
        [],
    )
    .unwrap();
    conn.execute("DELETE FROM invoke_owner_scope_state", [])
        .unwrap();
    conn.execute_batch("ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    let queries = super::super::count_read_only_probe::generated_trace_queries();
    let expected = ownership_rows(&conn, &queries);
    let fingerprint = ownership_content_hash(&conn);
    (base, queries, expected, fingerprint)
}

#[test]
fn ownership_small_cohorts_keep_shipping_results_and_nonownership_content_equal() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let base_directory = GeneratedBenchmarkDir::new();
    let (base, queries, expected, fingerprint) = ownership_small_base(&base_directory);
    for index in 0..OWNERSHIP_CONDITIONS.len() {
        let condition_directory = GeneratedBenchmarkDir::new();
        let fixture = ownership_fixture(
            &condition_directory,
            &base,
            index,
            10_000,
            1_000,
            &queries,
            &expected,
            &fingerprint,
        )
        .unwrap();
        let conn = Connection::open(&fixture.path).unwrap();
        assert_eq!(
            ownership_rows(&conn, &queries),
            expected,
            "{} preserves count outputs",
            OWNERSHIP_CONDITIONS[index].label
        );
        assert_eq!(
            ownership_content_hash(&conn),
            fingerprint,
            "{} changes only ownership fields",
            OWNERSHIP_CONDITIONS[index].label
        );
        let sql = MockSql::new(&condition_directory.path);
        let db = sql.load(&fixture.path);
        for (query, rows) in queries.iter().zip(&expected) {
            assert_eq!(
                sorted_rows(ipc(
                    &sql.webview,
                    "select",
                    json!({"db":db,"query":query,"values":[]})
                )),
                *rows,
                "{} reaches exact output through MockRuntime SQL IPC",
                OWNERSHIP_CONDITIONS[index].label
            );
        }
    }
}

#[test]
fn ownership_content_hash_detects_same_length_metadata_and_membership_changes() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let directory = GeneratedBenchmarkDir::new();
    let (base, _, _, fingerprint) = ownership_small_base(&directory);
    let conn = Connection::open(&base).unwrap();
    let original_metadata: String = conn
        .query_row(
            "SELECT metadata_json FROM images WHERE rowid=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    conn.execute(
        "UPDATE images SET metadata_json=replace(metadata_json, 'x', 'y') WHERE rowid=1",
        [],
    )
    .unwrap();
    assert_ne!(
        ownership_content_hash(&conn),
        fingerprint,
        "same-length metadata content is part of the matched cohort"
    );
    conn.execute(
        "UPDATE images SET metadata_json=?1 WHERE rowid=1",
        [original_metadata],
    )
    .unwrap();
    assert_eq!(
        ownership_content_hash(&conn),
        fingerprint,
        "the content check accepts the exact restored generated cohort"
    );
    let (collection_id, image_id): (String, String) = conn.query_row(
        "SELECT collection_id,image_id FROM collection_images ORDER BY collection_id,image_id LIMIT 1", [],
        |row| Ok((row.get(0)?,row.get(1)?)),
    ).unwrap();
    conn.execute("UPDATE collection_images SET collection_id='collection-378' WHERE collection_id=?1 AND image_id=?2",
        [&collection_id, &image_id]).unwrap();
    assert_ne!(
        ownership_content_hash(&conn),
        fingerprint,
        "membership identity is part of the matched cohort"
    );
}

#[test]
fn ownership_privacy_fixture_preserves_shipping_isolation_and_rejects_divergent_bypass() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let base_directory = GeneratedBenchmarkDir::new();
    let (base, queries, expected, fingerprint) = ownership_small_base(&base_directory);
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("privacy.db");
    std::fs::copy(&base, &path).unwrap();
    let condition = OWNERSHIP_CONDITIONS[4];
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute(
            "UPDATE images SET invoke_source_id='fixture.db', invoke_owner_id='generated-owner'",
            [],
        )
        .unwrap();
        set_scope(&conn, "owner", "generated-owner", true);
        conn.execute("UPDATE images SET invoke_source_id='other.db', invoke_owner_id='other-owner' WHERE rowid=1", []).unwrap();
        conn.execute("UPDATE images SET invoke_source_id=NULL, invoke_owner_id=NULL, invoke_scope_hidden=1 WHERE rowid=2", []).unwrap();
        conn.execute(
            "UPDATE images SET invoke_owner_id='other-owner' WHERE rowid=3",
            [],
        )
        .unwrap();
        conn.execute_batch("INSERT INTO removed_images (id,path,timestamp,removed_at,invoke_source_id,invoke_owner_id,invoke_scope_hidden)
            VALUES ('generated-removed-other','C:/Generated/removed.png',1,2,'other.db','other-owner',0);
            UPDATE collections SET invoke_suppressed=1 WHERE id='collection-000';").unwrap();
    }
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM scoped_images", [], |row| row.get(0))
            .unwrap(),
        9_997
    );
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM scoped_removed_images", [], |row| row
            .get(0))
            .unwrap(),
        0
    );
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT COUNT(*) FROM scoped_collections WHERE id='collection-000'",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        0
    );
    assert_ne!(
        ownership_rows(&conn, &queries),
        expected,
        "mixed ownership fixture must not enter equal-output timing"
    );
    assert_ne!(
        ownership_content_hash(&conn),
        fingerprint,
        "test mutations are deliberately outside matched cohort setup"
    );
    assert!(
        install_ownership_bypass(&directory, &path, 10_000, 1_000, condition).is_err(),
        "guard rejects a divergent privacy fixture before view replacement"
    );
}

#[test]
fn ownership_fixture_guards_reject_wrong_scope_outside_and_unexpected_paths() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let base_directory = GeneratedBenchmarkDir::new();
    let (base, queries, expected, fingerprint) = ownership_small_base(&base_directory);
    let directory = GeneratedBenchmarkDir::new();
    let fixture = ownership_fixture(
        &directory,
        &base,
        4,
        10_000,
        1_000,
        &queries,
        &expected,
        &fingerprint,
    )
    .unwrap();
    {
        let conn = Connection::open(&fixture.path).unwrap();
        set_scope(&conn, "all", "", true);
    }
    assert_eq!(
        validate_ownership_fixture(
            &directory,
            &fixture.path,
            10_000,
            1_000,
            OWNERSHIP_CONDITIONS[4]
        ),
        Err("invalid-generated-fixture")
    );
    assert_eq!(
        validate_ownership_fixture(&directory, &base, 10_000, 1_000, OWNERSHIP_CONDITIONS[4]),
        Err("invalid-generated-fixture")
    );
    std::fs::write(
        directory.path.join("unexpected.txt"),
        b"generated-only guard",
    )
    .unwrap();
    assert_eq!(
        validate_ownership_fixture(
            &directory,
            &fixture.path,
            10_000,
            1_000,
            OWNERSHIP_CONDITIONS[4]
        ),
        Err("invalid-generated-fixture")
    );
}

#[test]
fn ownership_fixture_guard_rejects_same_source_other_owner_and_other_source() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let base_directory = GeneratedBenchmarkDir::new();
    let (base, queries, expected, fingerprint) = ownership_small_base(&base_directory);
    for update in [
        "UPDATE images SET invoke_owner_id='other-owner' WHERE rowid=1",
        "UPDATE images SET invoke_source_id='other.db' WHERE rowid=2",
    ] {
        let directory = GeneratedBenchmarkDir::new();
        let fixture = ownership_fixture(
            &directory,
            &base,
            4,
            10_000,
            1_000,
            &queries,
            &expected,
            &fingerprint,
        )
        .unwrap();
        let conn = Connection::open(&fixture.path).unwrap();
        conn.execute(update, []).unwrap();
        assert_eq!(
            validate_ownership_fixture(
                &directory,
                &fixture.path,
                10_000,
                1_000,
                OWNERSHIP_CONDITIONS[4]
            ),
            Err("invalid-generated-fixture")
        );
    }
}

#[test]
fn ownership_preparation_failures_distinguish_copy_from_assignment() {
    let copy = OwnershipPreparationFailure::os(
        PreparationStage::FixtureCopy,
        Some("local-shipping"),
        Some(0),
        Duration::from_millis(7),
        Some(28),
    );
    let assignment = OwnershipPreparationFailure::sqlite(
        PreparationStage::OwnershipAssignment,
        Some("invoke-all-shipping"),
        Some(1),
        Duration::from_millis(9),
        5_178,
    );

    assert_ne!(copy.stage(), assignment.stage());
    assert_eq!(copy.category(), "os");
    assert_eq!(copy.os_code(), Some(28));
    assert_eq!(assignment.category(), "sqlite");
    assert_eq!(assignment.sqlite_code(), Some(5_178));
}

#[test]
fn ownership_preparation_failure_cleanup_and_redaction_are_retained() {
    let artifacts = GeneratedBenchmarkDir::new();
    let path = artifacts.path.join("preparation.jsonl");
    let mut report = OwnershipReport::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap(),
    );
    report.record(json!({"kind":"header"}));
    let mut prep = OwnershipPreparation {
        report: Some(&mut report),
        campaign: Instant::now(),
        condition: Some("invoke-all-shipping"),
        block: Some(0),
        last_stage: None,
        next_fixture_id: 0,
    };
    let mut removed_path = None;
    let failure = prep
        .with_directory::<()>(|directory, prep| {
            removed_path = Some(directory.path.clone());
            prep.enter(PreparationStage::ConnectionOpening);
            let conn = Connection::open(directory.path.join("generated.db")).unwrap();
            prep.enter(PreparationStage::OwnershipAssignment);
            let error = conn
                .execute("UPDATE PRIVATE_SENTINEL SET missing=1", [])
                .unwrap_err();
            Err(prep.sqlite_failure(&error).into())
        })
        .unwrap_err();
    assert!(
        !removed_path.unwrap().exists(),
        "connection must drop before explicit cleanup"
    );
    let detail = failure.preparation_failure().unwrap();
    assert_eq!(detail.stage(), "ownership-assignment");
    assert_eq!(detail.sqlite_code(), Some(1));
    // Preserve this failure even if the independent cleanup operation fails.
    let retained = preserve_preparation_result::<()>(
        Err(failure),
        crate::db::migrations::tests::GeneratedCleanupOutcome::Failed,
    )
    .unwrap_err();
    assert_eq!(
        retained.preparation_failure().unwrap().sqlite_code(),
        Some(1)
    );
    let panic = prep
        .with_directory::<()>(|_, prep| {
            prep.enter(PreparationStage::FixtureGeneration);
            panic!("PRIVATE_SENTINEL");
        })
        .unwrap_err();
    assert_eq!(panic.status(), "failed");
    assert_eq!(
        panic.preparation_failure().unwrap().stage(),
        "fixture-generation"
    );
    assert_eq!(panic.preparation_failure().unwrap().category(), "unknown");
    prep.enter(PreparationStage::FixtureCopy);
    let missing = std::fs::copy(
        artifacts.path.join("missing.db"),
        artifacts.path.join("unused.db"),
    )
    .unwrap_err();
    let io_detail = prep.os_failure(&missing);
    assert_eq!(io_detail.os_code(), missing.raw_os_error());
    drop(prep);
    report.finish(retained.status(), Duration::from_millis(3), Some(detail));
    drop(report);
    let text = std::fs::read_to_string(path).unwrap();
    assert!(!text.contains("PRIVATE_SENTINEL"));
    assert!(!text.contains(&artifacts.path.to_string_lossy().to_string()));
    let rows: Vec<Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let cleanup: Vec<_> = rows
        .iter()
        .filter(|row| row["kind"] == "fixture-cleanup")
        .collect();
    assert_eq!(cleanup.len(), 2);
    assert_eq!(cleanup[0]["fixtureId"], 0);
    assert_eq!(cleanup[1]["fixtureId"], 1);
    assert!(cleanup.iter().all(|row| row["outcome"] == "removed"));
    assert_eq!(
        rows.last().unwrap()["preparationFailure"]["stage"],
        "ownership-assignment"
    );
    assert!(rows
        .iter()
        .enumerate()
        .all(|(index, row)| row["sequence"] == index));
}

#[test]
fn prepared_ownership_templates_reuse_validated_small_fixtures_without_mutation() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let artifacts = GeneratedBenchmarkDir::new();
    let path = artifacts.path.join("preparation-order.jsonl");
    let mut report = OwnershipReport::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap(),
    );
    report.record(
        json!({"kind":"header","preparationDiagnosticsVersion":1,"fixturePolicy":"prepared-once-per-condition-v1",
        "templateCount":6,"templatePreparationOrder":OWNERSHIP_ORDER,"maxLiveCatalogs":8}),
    );
    let base_dir = GeneratedBenchmarkDir::new();
    let base = base_dir.path.join("base.db");
    seed_wide(&base, 600, 500);
    let conn = Connection::open(&base).unwrap();
    conn.execute_batch("UPDATE images SET invoke_source_id=NULL,invoke_owner_id=NULL; DELETE FROM invoke_owner_scope_state; ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
    let queries = super::super::count_read_only_probe::generated_trace_queries();
    let expected = ownership_rows(&conn, &queries);
    let content = ownership_content_hash(&conn);
    drop(conn);
    let mut prep = OwnershipPreparation {
        report: Some(&mut report),
        campaign: Instant::now(),
        condition: None,
        block: None,
        last_stage: None,
        next_fixture_id: 0,
    };
    let mut templates = std::array::from_fn(|_| None);
    with_prepared_ownership_templates(
        &mut prep,
        &base,
        600,
        500,
        &queries,
        &expected,
        &content,
        0,
        &mut templates,
        |templates, prep| {
            let template_hashes: [String; 6] = std::array::from_fn(|condition| {
                digest(&std::fs::read(&templates[condition].as_ref().unwrap().path).unwrap())
            });
            for block in 0..6 {
                for condition in ownership_order(block) {
                    prep.condition = Some(OWNERSHIP_CONDITIONS[condition].label);
                    prep.block = Some(block);
                    let fixture = templates[condition].as_ref().unwrap();
                    let connection = Connection::open(&fixture.path).unwrap();
                    assert_eq!(ownership_rows(&connection, &queries), expected);
                    assert_eq!(ownership_content_hash(&connection), content);
                    drop(connection);
                    prep.record(json!({"kind":"fixture","condition":OWNERSHIP_CONDITIONS[condition].label,
                        "block":block,"templateIndex":condition,"templateReused":block > 0,
                        "bytes":fixture.bytes,"sourceRows":fixture.source_rows,"exactResultEqual":true}));
                    prep.with_directory(|fresh_directory, prep| {
                        prep.enter(PreparationStage::FixtureCopy);
                        let fresh = fresh_directory.path.join("fresh.db");
                        std::fs::copy(&fixture.path, &fresh).map_err(|error| {
                            prep.os_failure(&error).with_legacy_status("failed")
                        })?;
                        let fresh_connection = Connection::open(&fresh)
                            .map_err(|error| prep.sqlite_failure(&error))?;
                        fresh_connection
                            .execute("UPDATE images SET invoke_source_id='mutated' WHERE rowid=1", [])
                            .map_err(|error| prep.sqlite_failure(&error))?;
                        drop(fresh_connection);
                        assert_eq!(
                            digest(&std::fs::read(&fixture.path).unwrap()),
                            template_hashes[condition],
                            "a fresh measured copy cannot mutate its template"
                        );
                        Ok(())
                    })?;
                }
            }
            prep.condition = Some(OWNERSHIP_CONDITIONS[0].label);
            prep.block = Some(0);
            let mut round = 0;
            let arm = ownership_arm(
                templates[0].as_ref().unwrap(),
                &queries,
                &expected,
                0,
                0,
                false,
                &mut round,
                prep.campaign,
                prep,
                None,
            )?;
            assert_eq!(round, 4);
            assert_eq!(arm.samples.len(), 16);
            Ok(())
        },
    )
    .unwrap();
    assert!(templates.iter().all(Option::is_none));
    drop(prep);
    assert_eq!(
        report.finish("completed", Duration::from_secs(1), None),
        "completed"
    );
    drop(report);
    let text = std::fs::read_to_string(&path).unwrap();
    let rows: Vec<Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let prepared: Vec<_> = rows
        .iter()
        .filter(|row| row["kind"] == "template-prepared")
        .collect();
    assert_eq!(prepared.len(), 6);
    for (prepared, condition) in prepared.iter().zip(OWNERSHIP_ORDER) {
        assert_eq!(prepared["condition"], OWNERSHIP_CONDITIONS[condition].label);
        assert_eq!(prepared["templateIndex"], condition);
        assert_eq!(prepared["exactResultEqual"], true);
    }
    let first_admission = rows
        .iter()
        .position(|row| row["kind"] == "fixture")
        .unwrap();
    for condition in OWNERSHIP_CONDITIONS {
        let actual: Vec<_> = rows[..first_admission]
            .iter()
            .filter(|row| row["kind"] == "preparation-stage" && row["condition"] == condition.label)
            .map(|row| row["stage"].as_str().unwrap())
            .collect();
        let mut expected = vec![
            "directory-creation",
            "fixture-copy",
            "connection-opening",
            "ownership-assignment",
            "scope-setup",
            "fixture-validation",
        ];
        if condition.bypass {
            expected.push("bypass-installation");
        }
        expected.extend([
            "connection-opening",
            "analysis",
            "checkpointing",
            "equality-check",
            "file-size-inspection",
        ]);
        assert_eq!(actual, expected);
    }
    assert_eq!(
        rows.iter()
            .filter(
                |row| row["kind"] == "preparation-stage" && row["stage"] == "ownership-assignment"
            )
            .count(),
        6,
        "six templates are prepared once before the six-block traversal"
    );
    let admissions: Vec<_> = rows.iter().filter(|row| row["kind"] == "fixture").collect();
    assert_eq!(admissions.len(), 36);
    for (index, admission) in admissions.iter().enumerate() {
        let block = index / 6;
        let condition = ownership_order(block)[index % 6];
        assert_eq!(
            admission["condition"],
            OWNERSHIP_CONDITIONS[condition].label
        );
        assert_eq!(admission["block"], block);
        assert_eq!(admission["templateIndex"], condition);
        assert_eq!(admission["templateReused"], block > 0);
        assert_eq!(admission["exactResultEqual"], true);
    }
    assert!(
        first_admission
            > rows
                .iter()
                .rposition(|row| row["kind"] == "template-prepared")
                .unwrap()
    );
    assert_eq!(
        rows.iter()
            .filter(|row| row["kind"] == "fixture-cleanup" && row["outcome"] == "removed")
            .count(),
        43
    );
    assert!(std::fs::metadata(&path).unwrap().len() <= OwnershipReport::LIMIT as u64);
    assert!(!text.contains("generated-owner"));
    assert!(!text.contains("collection-000"));
    assert!(!text.contains(&base_dir.path.to_string_lossy().to_string()));
    assert!(!text.contains(&artifacts.path.to_string_lossy().to_string()));
}

#[test]
fn prepared_ownership_template_cleanup_survives_error_and_panic() {
    let artifacts = GeneratedBenchmarkDir::new();
    let path = artifacts.path.join("template-cleanup.jsonl");
    let mut report = OwnershipReport::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap(),
    );
    report.record(json!({"kind":"header"}));
    let base_dir = GeneratedBenchmarkDir::new();
    let base = base_dir.path.join("base.db");
    seed_wide(&base, 600, 500);
    let conn = Connection::open(&base).unwrap();
    conn.execute_batch("UPDATE images SET invoke_source_id=NULL,invoke_owner_id=NULL; DELETE FROM invoke_owner_scope_state; ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
    let queries = super::super::count_read_only_probe::generated_trace_queries();
    let expected = ownership_rows(&conn, &queries);
    let content = ownership_content_hash(&conn);
    drop(conn);
    let mut prep = OwnershipPreparation {
        report: Some(&mut report),
        campaign: Instant::now(),
        condition: None,
        block: None,
        last_stage: None,
        next_fixture_id: 0,
    };
    let mut error_templates = std::array::from_fn(|_| None);
    let error = with_prepared_ownership_templates(
        &mut prep,
        &base,
        600,
        500,
        &queries,
        &expected,
        &content,
        0,
        &mut error_templates,
        |_, _| Err::<(), OwnershipCampaignFailure>("forced-template-error".into()),
    )
    .unwrap_err();
    assert_eq!(error.status(), "forced-template-error");
    assert!(error_templates.iter().all(Option::is_none));
    let mut panic_templates = std::array::from_fn(|_| None);
    let panic = with_prepared_ownership_templates(
        &mut prep,
        &base,
        600,
        500,
        &queries,
        &expected,
        &content,
        0,
        &mut panic_templates,
        |_, _| -> Result<(), OwnershipCampaignFailure> { panic!("PRIVATE_SENTINEL") },
    )
    .unwrap_err();
    assert_eq!(panic.status(), "failed");
    assert_eq!(
        panic.preparation_failure().unwrap().category(),
        "unknown",
        "a nested template panic keeps the guarded-cleanup failure path"
    );
    assert!(panic_templates.iter().all(Option::is_none));
    drop(prep);
    report.finish("failed", Duration::from_secs(1), None);
    drop(report);
    let text = std::fs::read_to_string(path).unwrap();
    let rows: Vec<Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        rows.iter()
            .filter(|row| row["kind"] == "fixture-cleanup" && row["outcome"] == "removed")
            .count(),
        12
    );
    assert!(!text.contains("PRIVATE_SENTINEL"));
    assert!(!text.contains(&base_dir.path.to_string_lossy().to_string()));
    assert!(!text.contains(&artifacts.path.to_string_lossy().to_string()));
}

#[test]
fn ownership_arm_rejects_a_contaminated_prepared_template_before_ipc() {
    let artifacts = GeneratedBenchmarkDir::new();
    let path = artifacts.path.join("template-contamination.jsonl");
    let mut report = OwnershipReport::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap(),
    );
    report.record(json!({"kind":"header"}));
    let base_dir = GeneratedBenchmarkDir::new();
    let base = base_dir.path.join("base.db");
    seed_wide(&base, 600, 500);
    let conn = Connection::open(&base).unwrap();
    conn.execute_batch("UPDATE images SET invoke_source_id=NULL,invoke_owner_id=NULL; DELETE FROM invoke_owner_scope_state; ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
    let queries = super::super::count_read_only_probe::generated_trace_queries();
    let expected = ownership_rows(&conn, &queries);
    let content = ownership_content_hash(&conn);
    drop(conn);
    let mut prep = OwnershipPreparation {
        report: Some(&mut report),
        campaign: Instant::now(),
        condition: Some(OWNERSHIP_CONDITIONS[0].label),
        block: Some(0),
        last_stage: None,
        next_fixture_id: 0,
    };
    prep.with_directory(|template_directory, prep| {
        let fixture = ownership_fixture_diagnosed(
            template_directory,
            &base,
            0,
            600,
            500,
            &queries,
            &expected,
            &content,
            prep,
        )?;
        std::fs::write(template_directory.path.join("unexpected-sibling"), b"x")
            .map_err(|error| prep.os_failure(&error).with_legacy_status("failed"))?;
        let mut round = 0;
        let failure = ownership_arm(
            &fixture,
            &queries,
            &expected,
            0,
            0,
            false,
            &mut round,
            prep.campaign,
            prep,
            None,
        )
        .err()
        .expect("contaminated template must be rejected");
        assert_eq!(failure.status(), "invalid-generated-fixture");
        assert_eq!(round, 0, "rejected template cannot start an IPC read");
        Ok(())
    })
    .unwrap();
    drop(prep);
    assert_eq!(
        report.finish("completed", Duration::from_secs(1), None),
        "completed"
    );
    drop(report);
    let rows: Vec<Value> = std::fs::read_to_string(&path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert!(rows.iter().all(|row| {
        !matches!(
            row["kind"].as_str(),
            Some("ipc" | "native" | "pool" | "overlap" | "native-group-span")
        )
    }));
    assert_eq!(
        rows.iter()
            .filter(|row| row["kind"] == "fixture-cleanup" && row["outcome"] == "removed")
            .count(),
        2,
        "the rejected arm and its prepared template both use guarded cleanup"
    );
}

#[test]
fn prepared_ownership_templates_stop_before_expired_preparation_starts() {
    let artifacts = GeneratedBenchmarkDir::new();
    let path = artifacts.path.join("template-deadline.jsonl");
    let mut report = OwnershipReport::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap(),
    );
    report.record(json!({"kind":"header"}));
    let queries = super::super::count_read_only_probe::generated_trace_queries();
    let mut prep = OwnershipPreparation {
        report: Some(&mut report),
        campaign: Instant::now() - OWNERSHIP_LIMIT,
        condition: None,
        block: None,
        last_stage: None,
        next_fixture_id: 0,
    };
    let mut templates = std::array::from_fn(|_| None);
    let failure = with_prepared_ownership_templates(
        &mut prep,
        &artifacts.path.join("unread-base.db"),
        600,
        500,
        &queries,
        &[],
        "",
        0,
        &mut templates,
        |_, _| Ok::<(), OwnershipCampaignFailure>(()),
    )
    .unwrap_err();
    assert_eq!(failure.status(), "timed-out");
    let final_handoff = with_prepared_ownership_templates(
        &mut prep,
        &artifacts.path.join("unread-base.db"),
        600,
        500,
        &queries,
        &[],
        "",
        OWNERSHIP_ORDER.len(),
        &mut templates,
        |_, _| -> Result<(), OwnershipCampaignFailure> { panic!("expired work must not run") },
    )
    .unwrap_err();
    assert_eq!(final_handoff.status(), "timed-out");
    assert_eq!(prep.next_fixture_id, 0);
    assert!(templates.iter().all(Option::is_none));
    drop(prep);
    report.finish("timed-out", Duration::from_secs(1), None);
    drop(report);
    let rows: Vec<Value> = std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert!(rows.iter().all(|row| {
        !matches!(
            row["kind"].as_str(),
            Some("template-prepared" | "fixture" | "fixture-cleanup")
        )
    }));
}

#[test]
fn ownership_preparation_storage_and_saturation_cannot_be_success() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("saturation.jsonl");
    let mut report = OwnershipReport::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap(),
    );
    report.record(json!({"kind":"header"}));
    report.record(json!({"kind":"padding","value":"x".repeat(OwnershipReport::LIMIT)}));
    assert_eq!(report.dropped, 1);
    assert_eq!(
        report.finish("completed", Duration::ZERO, None),
        "incomplete-trace"
    );
    drop(report);
    let text = std::fs::read_to_string(&path).unwrap();
    let terminal: Value = serde_json::from_str(text.lines().last().unwrap()).unwrap();
    assert_eq!(terminal["status"], "incomplete-trace");
    assert_eq!(terminal["droppedRecords"], 1);
    assert!(text.len() < OwnershipReport::LIMIT);
    let mut unavailable = OwnershipReport::new(File::open(&path).unwrap());
    unavailable.record(json!({"kind":"header"}));
    assert!(unavailable.storage_failed);
    assert_eq!(
        unavailable.finish("completed", Duration::ZERO, None),
        "incomplete-trace"
    );
    drop(unavailable);
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        text,
        "failed writes must not retry or corrupt existing evidence"
    );
    let failure_path = directory.path.join("failure-saturation.jsonl");
    let mut failed = OwnershipReport::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&failure_path)
            .unwrap(),
    );
    failed.record(json!({"kind":"header"}));
    failed.record(json!({"kind":"padding","value":"x".repeat(OwnershipReport::LIMIT)}));
    let detail = OwnershipPreparationFailure::sqlite(
        PreparationStage::Analysis,
        None,
        None,
        Duration::from_millis(4),
        13,
    );
    assert_eq!(
        failed.finish(
            "fixture-setup-failed",
            Duration::from_millis(5),
            Some(detail)
        ),
        "fixture-setup-failed"
    );
    drop(failed);
    let failed_text = std::fs::read_to_string(failure_path).unwrap();
    let terminal: Value = serde_json::from_str(failed_text.lines().last().unwrap()).unwrap();
    assert_eq!(terminal["status"], "fixture-setup-failed");
    assert_eq!(terminal["droppedRecords"], 1);
    assert_eq!(terminal["preparationFailure"]["sqliteCode"], 13);
}

#[test]
fn ownership_preparation_real_setup_failures_keep_legacy_status_and_safe_codes() {
    let base_directory = GeneratedBenchmarkDir::new();
    let missing = base_directory.path.join("missing.db");
    let empty = base_directory.path.join("empty.db");
    drop(Connection::open(&empty).unwrap());
    let queries = super::super::count_read_only_probe::generated_trace_queries();
    let mut prep = OwnershipPreparation {
        report: None,
        campaign: Instant::now(),
        condition: Some("invoke-all-shipping"),
        block: Some(0),
        last_stage: None,
        next_fixture_id: 0,
    };
    for (base, stage, status, category) in [
        (&missing, "fixture-copy", "fixture-copy-failed", "os"),
        (
            &empty,
            "ownership-assignment",
            "fixture-setup-failed",
            "sqlite",
        ),
    ] {
        let failure = prep
            .with_directory::<()>(|directory, prep| {
                ownership_fixture_diagnosed(directory, base, 2, 600, 500, &queries, &[], "", prep)?;
                Ok(())
            })
            .unwrap_err();
        let detail = failure.preparation_failure().unwrap();
        assert_eq!(failure.status(), status);
        assert_eq!(detail.stage(), stage);
        assert_eq!(detail.category(), category);
        if category == "sqlite" {
            assert_eq!(detail.sqlite_code(), Some(1));
        } else {
            assert!(detail.os_code().is_some());
        }
    }
    // Missing schema is an SQLite error, not a logical fixture mismatch.
    let failure = validate_ownership_fixture_checked(
        &base_directory,
        &empty,
        600,
        500,
        OWNERSHIP_CONDITIONS[0],
    )
    .unwrap_err();
    assert_eq!(failure.status, "invalid-generated-fixture");
    assert!(failure.sqlite);
    assert_eq!(failure.code, Some(1));
    let scope_error = ownership_scope(&Connection::open_in_memory().unwrap(), false).unwrap_err();
    prep.enter(PreparationStage::ScopeSetup);
    let scope_failure = prep.sqlite_failure(&scope_error);
    assert_eq!(scope_failure.stage(), "scope-setup");
    assert_eq!(scope_failure.sqlite_code(), Some(1));
    prep.enter(PreparationStage::EqualityCheck);
    let empty_connection = Connection::open_in_memory().unwrap();
    for error in [
        ownership_rows_checked(&empty_connection, &queries).unwrap_err(),
        ownership_content_hash_checked(&empty_connection).unwrap_err(),
    ] {
        let equality_failure = prep.sqlite_failure(&error);
        assert_eq!(equality_failure.stage(), "equality-check");
        assert_eq!(equality_failure.category(), "sqlite");
        assert_eq!(equality_failure.sqlite_code(), Some(1));
    }
}

#[test]
fn ownership_order_medians_and_group_spans_follow_the_campaign_definition() {
    for block in 0..6 {
        let order = ownership_order(block);
        assert_eq!(
            order
                .into_iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            6
        );
        assert_eq!(
            order,
            std::array::from_fn(|index| (OWNERSHIP_ORDER[index] + block) % 6)
        );
    }
    assert_eq!(median(&[3.0, 1.0, 2.0]), 2.0);
    assert_eq!(median(&[4.0, 1.0, 3.0, 2.0]), 2.5);
    let mut arm = OverlapArm {
        samples: [OverlapSample::default(); 16],
        settings: Vec::new(),
    };
    for (index, sample) in arm.samples[..4].iter_mut().enumerate() {
        sample.started = [4.0, 1.0, 8.0, 3.0][index];
        sample.native = [2.0, 2.0, 5.0, 3.0][index];
    }
    assert_eq!(
        ownership_span(&arm, 0),
        12.0,
        "span includes the complete four-query native interval"
    );
}

#[test]
fn ownership_report_reserves_terminal_capacity_and_never_reuses_evidence_paths() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("ownership-capacity.jsonl");
    let mut report = OwnershipReport::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap(),
    );
    report.record(json!({"kind":"header","padding":"x".repeat(900_000)}));
    report.finish("completed", Duration::from_secs(1), None);
    drop(report);
    assert!(std::fs::metadata(&path).unwrap().len() <= OwnershipReport::LIMIT as u64);
    assert!(OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .is_err());
    let rows: Vec<Value> = std::fs::read_to_string(&path)
        .unwrap()
        .lines()
        .map(serde_json::from_str)
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(rows.last().unwrap()["kind"], "terminal");
    assert_eq!(rows.last().unwrap()["sequence"], 1);
}

#[test]
fn ownership_report_full_campaign_shape_fits_and_partial_drop_is_terminal() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("ownership-full-shape.jsonl");
    let mut report = OwnershipReport::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap(),
    );
    report.record(json!({"kind":"header","preparationDiagnosticsVersion":1,"conditions":OWNERSHIP_CONDITIONS.iter().map(|condition|condition.label).collect::<Vec<_>>(),
        "fixturePolicy":"prepared-once-per-condition-v1","templateCount":6,
        "templatePreparationOrder":OWNERSHIP_ORDER,"maxLiveCatalogs":8 }));
    let distribution: Vec<_> = (0..10)
        .map(|slot| json!(["wal", 2, 5000, -2000, 0, 0, slot + 1]))
        .collect();
    for condition in OWNERSHIP_ORDER {
        for stage in [
            "directory-creation",
            "fixture-copy",
            "connection-opening",
            "ownership-assignment",
            "scope-setup",
            "fixture-validation",
            "bypass-installation",
            "connection-opening",
            "analysis",
            "checkpointing",
            "equality-check",
            "file-size-inspection",
        ] {
            report.record(json!({"kind":"preparation-stage","stage":stage,"condition":OWNERSHIP_CONDITIONS[condition].label,"block":0,"elapsedMs":2700000.0}));
        }
        report.record(json!({"kind":"template-prepared","condition":OWNERSHIP_CONDITIONS[condition].label,
            "templateIndex":condition,"bytes":123456789,"sourceRows":146182,"exactResultEqual":true}));
    }
    for block in 0..6 {
        for condition in ownership_order(block) {
            report.record(json!({"kind":"fixture","condition":OWNERSHIP_CONDITIONS[condition].label,"block":block,
                "templateIndex":condition,"templateReused":block > 0,
                "bytes":123456789,"sourceRows":146182,"exactResultEqual":true}));
            for boundary in 0..2 {
                for stage in ["directory-creation", "fixture-copy", "connection-opening"] {
                    report.record(json!({"kind":"preparation-stage","stage":stage,"condition":OWNERSHIP_CONDITIONS[condition].label,"block":block,"elapsedMs":2700000.0}));
                }
                report
                    .record(json!({"kind":"fixture-cleanup","fixtureId":109,"outcome":"removed"}));
                for stage in ["before", "after"] {
                    report.record(json!({"kind":"pool","catalog":condition,"pair":block,"concurrent":boundary == 1,"stage":stage,
                        "openingMs":123456.0,"preparationMs":123456.0,"untreatedDistribution":distribution,
                        "distribution":distribution,"markerPolicy":"unused-collation-lifetime-v1","stable":true,
                        "closedOriginals":0,"markerCalls":0}));
                }
                for read in 0..4 {
                    for query in 0..4 {
                        report.record(json!({"kind":"ipc","data":[condition,block,boundary,read,query,read*4+query,123456.0,true]}));
                        report.record(json!({"kind":"native","data":[condition,block,boundary,read,query,read*4+query,1.0,2.0,3.0,4.0,5.0,6.0,7.0]}));
                    }
                    report.record(json!({"kind":"overlap","catalog":condition,"pair":block,"concurrent":boundary == 1,
                        "read":read,"nativePairOverlapMs":vec![123456.0;6],"pairOrder":"01-02-03-12-13-23"}));
                    report.record(json!({"kind":"native-group-span","condition":OWNERSHIP_CONDITIONS[condition].label,
                        "block":block,"boundary":if boundary == 1 {"concurrent"} else {"sequential"},"read":read,"nativeSpanMs":123456.0}));
                }
            }
            report.record(json!({"kind":"boundary-settings","condition":OWNERSHIP_CONDITIONS[condition].label,"block":block,"equal":true}));
            report.record(json!({"kind":"fixture-cleanup","fixtureId":109,"outcome":"removed"}));
        }
    }
    for condition in 0..6 {
        for boundary in ["sequential", "concurrent"] {
            for query in LABELS {
                report.record(json!({"kind":"ownership-summary","condition":OWNERSHIP_CONDITIONS[condition].label,"boundary":boundary,
            "query":query,"firstMs":vec![123456.0;6],"firstMedianMs":123456.0,"warmBlockMedianMs":vec![123456.0;6],"warmMedianMs":123456.0,
            "slowestMs":123456.0,"firstNativeGroupSpanMs":vec![123456.0;6],"firstNativeGroupSpanMedianMs":123456.0,
            "warmNativeGroupSpanBlockMedianMs":vec![123456.0;6],"warmNativeGroupSpanMedianMs":123456.0}));
            }
        }
    }
    for comparison in [
        "shipping-vs-bypass",
        "all-users-vs-local",
        "selected-owner-vs-all-users",
    ] {
        for boundary in ["sequential", "concurrent"] {
            for query in LABELS {
                report.record(json!({"kind":"ownership-comparison","comparison":comparison,"query":query,"boundary":boundary,
                "baseline":"condition","candidate":"condition","baselineBlockWarmMs":vec![123456.0;6],"candidateBlockWarmMs":vec![123456.0;6],
                "baselineMedianMs":123456.0,"candidateMedianMs":123456.0,"absoluteMs":0.0,"percent":0.0,"sameDirectionBlocks":0,"repeatableMaterialPenalty":false}));
            }
        }
    }
    // Include base preparation and cleanup, without estimating these as count time.
    for _ in 0..12 {
        report.record(
            json!({"kind":"preparation-stage","stage":"fixture-generation","elapsedMs":2700000.0}),
        );
    }
    report.record(json!({"kind":"fixture-cleanup","fixtureId":0,"outcome":"removed"}));
    assert_eq!(
        report.finish("completed", Duration::from_secs(2700), None),
        "completed"
    );
    assert_eq!(report.dropped, 0);
    assert!(report.bytes < OwnershipReport::LIMIT);
    drop(report);
    assert!(std::fs::metadata(&path).unwrap().len() <= OwnershipReport::LIMIT as u64);
    let partial = directory.path.join("ownership-partial.jsonl");
    {
        let mut report = OwnershipReport::new(
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&partial)
                .unwrap(),
        );
        report.record(json!({"kind":"header"}));
    }
    assert!(std::fs::read_to_string(partial)
        .unwrap()
        .contains("\"status\":\"interrupted\""));
}

#[test]
#[ignore = "one approved generated-only ownership campaign; controller opt-in and deadlines required"]
fn measure_startup_sql_ownership_once() {
    assert_eq!(
        std::env::var("AMBIT_SQL_TRACE_OWNERSHIP").as_deref(),
        Ok("1")
    );
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let id = uuid::Uuid::parse_str(
        &std::env::var("AMBIT_SQL_TRACE_OWNERSHIP_ID").expect("use ownership deadline controller"),
    )
    .unwrap();
    let artifact = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join(format!("startup-sql-ownership-{id}.jsonl"));
    let mut report = OwnershipReport::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&artifact)
            .unwrap(),
    );
    let campaign = Instant::now();
    let queries = super::super::count_read_only_probe::generated_trace_queries();
    let revision = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .unwrap();
    let revision = String::from_utf8(revision.stdout).unwrap();
    assert!(
        revision.trim().len() == 40 && revision.trim().bytes().all(|byte| byte.is_ascii_hexdigit())
    );
    report.record(json!({"kind":"header","schema":1,"evidenceId":id,"revision":revision.trim(),
        "preparationDiagnosticsVersion":1,"budgetMs":OWNERSHIP_LIMIT.as_millis(),
        "preparationTimingBoundary":"elapsedMs is campaign elapsed time at stage entry or failure; panic stage is last known, not proof of cause",
        "generatedDirectorySourceHash":digest(include_bytes!("../mod.rs")),
        "conditions":OWNERSHIP_CONDITIONS.iter().map(|condition| json!({"label":condition.label,"invoke":condition.invoke,"selectedOwner":condition.selected_owner,"bypass":condition.bypass})).collect::<Vec<_>>(),
        "blocks":6,"order":OWNERSHIP_ORDER,"firstReads":1,"warmReads":3,"images":146182,"memberships":131741,
        "fixturePolicy":"prepared-once-per-condition-v1","templateCount":6,
        "templatePreparationOrder":OWNERSHIP_ORDER,"maxLiveCatalogs":8,
        "poolTreatment":"all-ten-observed-defaults-wal-v1","queryHashes":queries.iter().map(|query|digest(query.as_bytes())).collect::<Vec<_>>(),
        "fixtureSourceHash":digest(include_bytes!("count_index_benchmark.rs")),"catalogSourceHash":digest(include_bytes!("../collection_stats_query_tests.rs")),
        "harnessHash":digest(include_bytes!("startup_sql_overhead.rs")),"controllerHash":digest(include_bytes!("../../../../../scripts/run-startup-sql-overhead.mjs")),
        "setupSourceHash":digest(include_bytes!("../sql_plugin_tests.rs")),"vendorHash":vendor_digest(),
        "adapterSourceHash":digest(include_bytes!("../../../startup_sql_trace.rs")),"journalSourceHash":digest(include_bytes!("../../../startup_log.rs")),
        "controlHash":digest(OWNERSHIP_BYPASS_SQL.as_bytes()),
        "queryLabels":LABELS,
        "recordFieldAliases":{"catalog":"conditionIndex","pair":"block","concurrent":"boundary"},
        "ipcColumns":["conditionIndex","block","boundary","read","queryIndex","callId","ipcMs","exactResultEqual"],
        "nativeColumns":["conditionIndex","block","boundary","read","queryIndex","callId","startedMs","totalMs","registryMs","bindMs","acquireMs","retrievalMs","conversionMs"],
        "poolDistributionColumns":["journalMode","synchronous","busyTimeout","cacheSize","tempStore","mmapSize","connections"],
        "nativeGroupSpan":"max(nativeStartedMs + nativeTotalMs) - min(nativeStartedMs), per four-query read; first and warm aggregation are reported separately",
        "boundary":"generated MockRuntime IPC; native span is earliest native entry to latest native completion; not startup acceptance or source synchronization"}));
    let mut preparation = OwnershipPreparation {
        report: Some(&mut report),
        campaign,
        condition: None,
        block: None,
        last_stage: None,
        next_fixture_id: 0,
    };
    let outcome = preparation.with_directory(|directory, preparation| {
            let base = directory.path.join("ownership-base.db");
            preparation.enter(PreparationStage::FixtureGeneration);
            seed_wide(&base, 146182, 131741);
            {
                preparation.enter(PreparationStage::ConnectionOpening);
                let conn = Connection::open(&base).map_err(|error| preparation.sqlite_failure(&error))?;
                preparation.enter(PreparationStage::OwnershipAssignment);
                conn.execute(
                    "UPDATE images SET invoke_source_id=NULL, invoke_owner_id=NULL",
                    [],
                )
                .map_err(|error| preparation.sqlite_failure(&error))?;
                preparation.enter(PreparationStage::ScopeSetup);
                conn.execute("DELETE FROM invoke_owner_scope_state", [])
                    .map_err(|error| preparation.sqlite_failure(&error))?;
                preparation.enter(PreparationStage::Analysis);
                conn.execute_batch("ANALYZE;").map_err(|error| preparation.sqlite_failure(&error))?;
                preparation.enter(PreparationStage::Checkpointing);
                conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").map_err(|error| preparation.sqlite_failure(&error))?;
            }
            preparation.enter(PreparationStage::ConnectionOpening);
            let base_conn = Connection::open(&base).map_err(|error| preparation.sqlite_failure(&error))?;
            preparation.enter(PreparationStage::EqualityCheck);
        let expected = ownership_rows_checked(&base_conn, &queries).map_err(|error| preparation.sqlite_failure(&error))?;
        let expected_content_hash = ownership_content_hash_checked(&base_conn).map_err(|error| preparation.sqlite_failure(&error))?;
            drop(base_conn);
            let mut templates = std::array::from_fn(|_| None);
            with_prepared_ownership_templates(
                preparation,
                &base,
                146182,
                131741,
                &queries,
                &expected,
                &expected_content_hash,
                0,
                &mut templates,
                |templates, preparation| {
                    let mut matrix: Vec<Vec<[OverlapArm; 2]>> =
                        (0..6).map(|_| Vec::new()).collect();
                    let mut round = 0;
                    for block in 0..6 {
                        if campaign.elapsed() >= OWNERSHIP_LIMIT {
                            return Err("timed-out".into());
                        }
                        for condition in ownership_order(block) {
                            preparation.condition = Some(OWNERSHIP_CONDITIONS[condition].label);
                            preparation.block = Some(block);
                            let fixture = templates[condition]
                                .as_ref()
                                .expect("prepared ownership template");
                            preparation.record(json!({"kind":"fixture","condition":OWNERSHIP_CONDITIONS[condition].label,
                                "block":block,"templateIndex":condition,"templateReused":block > 0,
                                "bytes":fixture.bytes,"sourceRows":fixture.source_rows,"exactResultEqual":true}));
                            let mut arms: [Option<OverlapArm>; 2] = [None, None];
                            for concurrent in if block % 2 == 0 {
                                [false, true]
                            } else {
                                [true, false]
                            } {
                                let boundary = usize::from(concurrent);
                                let other = arms[usize::from(!concurrent)]
                                    .as_ref()
                                    .map(|arm| arm.settings.as_slice());
                                let arm = ownership_arm(
                                    fixture,
                                    &queries,
                                    &expected,
                                    condition,
                                    block,
                                    concurrent,
                                    &mut round,
                                    campaign,
                                    preparation,
                                    other,
                                )?;
                                if arms[usize::from(!concurrent)]
                                    .as_ref()
                                    .is_some_and(|other| other.settings != arm.settings)
                                {
                                    preparation.record(json!({"kind":"boundary-settings","condition":OWNERSHIP_CONDITIONS[condition].label,"block":block,"equal":false}));
                                    return Err("invalid-comparison".into());
                                }
                                arms[boundary] = Some(arm);
                            }
                            preparation.record(json!({"kind":"boundary-settings","condition":OWNERSHIP_CONDITIONS[condition].label,"block":block,"equal":true}));
                            matrix[condition].push(arms.map(Option::unwrap));
                        }
                    }
                    if round != 288 {
                        return Err("incomplete-rounds".into());
                    }
                    ownership_summary(&matrix, preparation);
                    Ok(())
                },
            )
    });
    drop(preparation);
    let status = outcome
        .as_ref()
        .err()
        .map_or("completed", |failure| failure.status());
    let detail = outcome
        .as_ref()
        .err()
        .and_then(|failure| failure.preparation_failure());
    let status = report.finish(status, campaign.elapsed(), detail);
    assert_eq!(
        status, "completed",
        "partial ownership evidence ends the approved campaign without rerun"
    );
}

#[test]
#[ignore = "one approved generated-only SQL diagnostic overhead campaign; explicit opt-in"]
fn measure_startup_sql_trace_overhead_once() {
    assert_eq!(
        std::env::var("AMBIT_SQL_TRACE_OVERHEAD").as_deref(),
        Ok("1")
    );
    let runtime = tauri::async_runtime::handle();
    let _runtime_context = runtime.inner().enter();
    let evidence_id = uuid::Uuid::parse_str(
        &std::env::var("AMBIT_SQL_TRACE_OVERHEAD_ID").expect("use deadline controller"),
    )
    .unwrap();
    let artifact = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join(format!("startup-sql-overhead-{evidence_id}.jsonl"));
    let mut report = Report {
        file: OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&artifact)
            .unwrap(),
        sequence: 0,
        bytes: 0,
        terminal: false,
    };
    let start = Instant::now();
    let queries = super::super::count_read_only_probe::generated_trace_queries();
    let query_hashes: Vec<String> = queries
        .iter()
        .map(|query| {
            Sha256::digest(query.as_bytes())
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect()
        })
        .collect();
    report.record(json!({"kind":"header","schema":1,"evidenceId":evidence_id.to_string(),"pairs":6,"firstReads":1,"warmReads":3,
        "queryHashes":query_hashes,
        "fixture":"existing-wide-10k-1k-unindexed-all-users","pluginVersion":"2.4.0",
        "boundary":"generated MockRuntime IPC with live journal observer; disabled/enabled tracing in same feature build; excludes actual renderer/IPC-report overhead; not OS-cold or startup acceptance"}));
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let directory = GeneratedBenchmarkDir::new();
        let template = directory.path.join("template.db");
        seed_wide(&template, 10_000, 1_000);
        let expected: Vec<_> = {
            let conn = Connection::open(&template).unwrap();
            set_scope(&conn, "all", "", true);
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
                .unwrap();
            queries
                .iter()
                .map(|query| direct_count_rows(&conn, query))
                .collect()
        };
        let mut samples: [[Vec<f64>; 8]; 2] =
            std::array::from_fn(|_| std::array::from_fn(|_| Vec::new()));
        for pair in 0..6 {
            for enabled in if pair % 2 == 0 {
                [false, true]
            } else {
                [true, false]
            } {
                if start.elapsed() >= LIMIT {
                    return "timed-out";
                }
                let arm_directory = GeneratedBenchmarkDir::new();
                let path = arm_directory.path.join("sample.db");
                std::fs::copy(&template, &path).unwrap();
                let db_url = super::super::fixture_url(&path);
                let origin = Instant::now();
                let journal = std::sync::Arc::new(crate::startup_log::StartupJournal::new(
                    origin,
                    Some(&arm_directory.path.join("logs")),
                ));
                let launch = journal.launch_id.clone();
                let collector = Collector::new(launch.clone(), vec![db_url.clone()], origin);
                if enabled {
                    journal.install_sql_trace(collector.clone());
                }
                journal.start_observer();
                let _observer = Observer(journal.clone());
                let builder = tauri_plugin_sql::Builder::default();
                let builder = if enabled {
                    builder.startup_trace(collector.clone())
                } else {
                    builder
                };
                let sql = MockSql::with_builder(&arm_directory.path, builder, &[]);
                let db = sql.load(&path);
                configure_via_ipc(&sql, &db);
                for repetition in 0..4 {
                    for q in if pair % 2 == 0 {
                        [0, 1, 2, 3]
                    } else {
                        [3, 2, 1, 0]
                    } {
                        if start.elapsed() >= LIMIT {
                            return "timed-out";
                        }
                        let call_id = repetition * 4 + q + 1;
                        let mut body = json!({"db":db,"query":queries[q],"values":[]});
                        if enabled {
                            body["startupTrace"] =
                                json!({"launchId":launch,"callId":call_id,"label":LABELS[q]});
                        }
                        let timer = Instant::now();
                        let result = super::super::ipc_result(&sql.webview, "select", body);
                        let ms = timer.elapsed().as_secs_f64() * 1000.0;
                        if start.elapsed() >= LIMIT {
                            return "timed-out";
                        }
                        let Ok(result) = result else {
                            return "query-failed";
                        };
                        let equal = sorted_rows(result) == expected[q];
                        if enabled {
                            journal.sql_frontend(crate::startup::StartupSqlFrontend {
                                launch_id: launch.clone(),
                                call_id: call_id as u32,
                                label: serde_json::from_value(json!(LABELS[q])).unwrap(),
                                duration_ms: ms.ceil() as u64,
                                status: crate::startup::StartupSqlStatus::Completed,
                            });
                        }
                        report.record(json!({"kind":"sample","pair":pair,"enabled":enabled,"read":repetition,"query":LABELS[q],"ms":ms,"exactResultEqual":equal}));
                        if !equal {
                            return "result-mismatch";
                        }
                        samples[usize::from(enabled)][q + if repetition == 0 { 0 } else { 4 }]
                            .push(ms);
                    }
                }
                journal.request_end();
                super::super::wait_until("generated journal teardown", || {
                    journal.sql_observation_finished()
                });
                if enabled {
                    // Only the live observer consumes collector records. Validate its persisted output.
                    let text = std::fs::read_to_string(
                        arm_directory
                            .path
                            .join("logs")
                            .join(format!("startup-{launch}.jsonl")),
                    )
                    .unwrap();
                    let records: Vec<Value> = text
                        .lines()
                        .map(|line| serde_json::from_str(line).unwrap())
                        .collect();
                    let counts: Vec<_> = records
                        .iter()
                        .filter(|record| record["kind"] == "sql-count")
                        .collect();
                    let Some(summary) = records
                        .iter()
                        .find(|record| record["kind"] == "sql-trace-summary")
                    else {
                        return "incomplete-trace";
                    };
                    let complete = counts.len() == 16
                        && counts.iter().all(|record| {
                            record["matched"] == true && record["native"]["status"] == "completed"
                        })
                        && summary["detailedAdmitted"] == 16
                        && summary["detailedPending"] == 0
                        && summary["detailedDropped"] == 0
                        && summary["coarseDropped"] == 0
                        && summary["frontendDropped"] == 0;
                    report.record(json!({"kind":"trace-check","pair":pair,"complete":complete,"matchedCount":counts.len(),
                        "detailedDropped":summary["detailedDropped"],"coarseDropped":summary["coarseDropped"],"frontendDropped":summary["frontendDropped"]}));
                    if !complete {
                        return "incomplete-trace";
                    }
                }
            }
        }
        let mut passed = true;
        for index in 0..8 {
            let baseline = median(&samples[0][index]);
            let traced = median(&samples[1][index]);
            let accepted = qualifies(baseline, traced, false);
            passed &= accepted;
            report.record(json!({"kind":"comparison","query":LABELS[index%4],"read":if index<4 {"first"} else {"warm"},
                "baselineMedianMs":baseline,"tracedMedianMs":traced,"accepted":accepted}));
        }
        if passed {
            "completed"
        } else {
            "overhead-gate-failed"
        }
    }));
    let status = outcome.unwrap_or("failed");
    report.finish(status, start.elapsed());
    println!(
        "SQL trace overhead evidence: {} ({status})",
        artifact.display()
    );
    assert_eq!(
        status, "completed",
        "failed overhead gate must stop owner qualification; no timing-driven rerun"
    );
}
