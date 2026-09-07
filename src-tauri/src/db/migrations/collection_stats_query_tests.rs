//! Opt-in, generated-data-only feasibility checks for the approved two query alternatives.

use super::{get_migrations, tests::GeneratedBenchmarkDir};
use rusqlite::{params, Connection, OpenFlags};
use serde_json::json;
use std::{
    path::Path,
    sync::{Arc, Barrier},
    time::Instant,
};

const BASELINE: &str = "SELECT ci.collection_id, COUNT(*) as count
         FROM scoped_collections c
         JOIN collection_images ci ON ci.collection_id = c.id
         JOIN scoped_images i ON i.id = ci.image_id
         WHERE i.invoke_scope_hidden = 0
         GROUP BY ci.collection_id";
const VISIBLE_IDS: &str = "SELECT ci.collection_id, COUNT(*) as count
         FROM scoped_collections c
         JOIN collection_images ci ON ci.collection_id = c.id
         WHERE ci.image_id IN (
             SELECT id FROM scoped_images WHERE invoke_scope_hidden = 0
         )
         GROUP BY ci.collection_id";
const MEMBER_IDS: &str = "SELECT ci.collection_id, COUNT(*) as count
         FROM scoped_collections c
         JOIN collection_images ci ON ci.collection_id = c.id
         WHERE ci.image_id IN (
             SELECT id FROM scoped_images WHERE invoke_scope_hidden = 0
             AND id IN (
                 SELECT m.image_id FROM scoped_collections visible_collections
                 JOIN collection_images m ON m.collection_id = visible_collections.id
             )
         )
         GROUP BY ci.collection_id";
const QUERIES: [(&str, &str); 3] = [
    ("baseline", BASELINE),
    ("visible_ids", VISIBLE_IDS),
    ("member_ids", MEMBER_IDS),
];
const ORDERS: [[usize; 3]; 6] = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
    [1, 0, 2],
    [0, 2, 1],
];
const PERFORMANCE_PRAGMAS: &str = "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    PRAGMA busy_timeout=60000; PRAGMA cache_size=-64000;
    PRAGMA temp_store=MEMORY; PRAGMA mmap_size=268435456;";
type Counts = Vec<(String, i64)>;

fn passes_timing_gate(baseline_ms: f64, candidate_ms: f64, primary: bool) -> bool {
    candidate_ms
        <= if primary {
            baseline_ms * 0.8
        } else if baseline_ms < 200.0 {
            baseline_ms + 20.0
        } else {
            baseline_ms * 1.1
        }
}

#[test]
fn query_only_timing_gates_require_material_primary_gain_without_small_library_regression() {
    assert!(passes_timing_gate(1000.0, 800.0, true));
    assert!(!passes_timing_gate(1000.0, 801.0, true));
    assert!(passes_timing_gate(1000.0, 1100.0, false));
    assert!(!passes_timing_gate(1000.0, 1101.0, false));
    assert!(passes_timing_gate(10.0, 30.0, false));
    assert!(!passes_timing_gate(10.0, 31.0, false));
}

fn normalized(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn query_only_baseline_is_the_unchanged_production_query() {
    assert_eq!(
        normalized(BASELINE),
        normalized(super::tests::production_collection_stats_query())
    );
}

fn migrate(conn: &Connection) {
    for migration in get_migrations() {
        conn.execute_batch(migration.sql)
            .unwrap_or_else(|error| panic!("migration {}: {error}", migration.version));
    }
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

pub(super) fn set_scope(conn: &Connection, mode: &str, owner: &str, verified: bool) {
    conn.execute("DELETE FROM invoke_owner_scope_state", [])
        .unwrap();
    if mode != "none" {
        conn.execute(
            "INSERT INTO invoke_owner_scope_state
            (state_key, db_path, images_root, scope_mode, owner_id, updated_at, boards_verified)
            VALUES ('current', 'fixture.db', 'C:/SyntheticSource', ?1, ?2, 1, ?3)",
            params![
                mode,
                if owner.is_empty() { None } else { Some(owner) },
                i64::from(verified)
            ],
        )
        .unwrap();
    }
}

fn fetch(conn: &Connection, sql: &str) -> Counts {
    conn.prepare(sql)
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn check_counts(conn: &Connection, expected: &[(&str, i64)]) {
    let expected: Counts = expected
        .iter()
        .map(|(id, count)| ((*id).into(), *count))
        .collect();
    for (label, sql) in QUERIES {
        let mut observed = fetch(conn, sql);
        observed.sort_unstable();
        assert_eq!(observed, expected, "{label}");
    }
}

#[test]
fn query_only_candidates_preserve_visibility_and_membership_transitions() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn);
    conn.execute_batch("INSERT INTO images
        (id, path, timestamp, invoke_source_id, invoke_owner_id, invoke_scope_hidden) VALUES
        ('local', 'C:/Library/local.png', 1, NULL, NULL, 0),
        ('hidden-local', 'C:/Library/hidden.png', 1, NULL, NULL, 1),
        ('a', 'C:/Library/a.png', 1, 'fixture.db', 'a', 0),
        ('hidden-a', 'C:/Library/hidden-a.png', 1, 'fixture.db', 'a', 1),
        ('b', 'C:/Library/b.png', 1, 'fixture.db', 'b', 0),
        ('shared', 'C:/Library/shared.png', 1, 'fixture.db', NULL, 0),
        ('other', 'C:/Library/other.png', 1, 'other.db', 'a', 0);
        INSERT INTO collections
        (id, name, source, invoke_source_id, invoke_owner_id, invoke_board_verified, invoke_suppressed) VALUES
        ('a', 'A', 'ambit', 'fixture.db', 'a', 1, 0),
        ('b', 'B', 'ambit', 'fixture.db', 'b', 1, 0),
        ('board', 'Board', 'invoke', 'fixture.db', 'a', 1, 0),
        ('empty', 'Empty', 'ambit', NULL, NULL, 1, 0),
        ('global', 'Global', 'ambit', NULL, NULL, 1, 0),
        ('mixed', 'Mixed', 'ambit', NULL, NULL, 1, 0),
        ('other', 'Other', 'invoke', 'other.db', 'a', 1, 0),
        ('shared', 'Shared', 'ambit', 'fixture.db', NULL, 1, 0),
        ('suppressed', 'Suppressed', 'invoke', 'fixture.db', 'a', 1, 1),
        ('unverified', 'Unverified', 'invoke', 'fixture.db', 'a', 0, 0);
        INSERT INTO collection_images (collection_id, image_id) VALUES
        ('a', 'a'), ('a', 'local'), ('a', 'hidden-a'), ('b', 'b'),
        ('board', 'a'), ('global', 'local'), ('global', 'hidden-local'),
        ('mixed', 'local'), ('mixed', 'a'), ('mixed', 'b'), ('mixed', 'shared'),
        ('mixed', 'hidden-a'), ('mixed', 'other'), ('other', 'other'),
        ('shared', 'shared'), ('suppressed', 'a'), ('unverified', 'a');").unwrap();
    check_counts(&conn, &[("global", 1), ("mixed", 1)]);
    for mode in ["legacy", "all"] {
        set_scope(&conn, mode, "", true);
        check_counts(
            &conn,
            &[
                ("a", 2),
                ("b", 1),
                ("board", 1),
                ("global", 1),
                ("mixed", 4),
                ("shared", 1),
                ("unverified", 1),
            ],
        );
    }
    set_scope(&conn, "owner", "a", true);
    check_counts(
        &conn,
        &[("a", 2), ("board", 1), ("global", 1), ("mixed", 2)],
    );
    set_scope(&conn, "owner", "a", false);
    check_counts(&conn, &[("a", 2), ("global", 1), ("mixed", 2)]);
    set_scope(&conn, "owner", "b", true);
    check_counts(&conn, &[("b", 1), ("global", 1), ("mixed", 2)]);
    set_scope(&conn, "owner", "a", true);
    conn.execute_batch("INSERT INTO removed_images (id, path, timestamp, removed_at, invoke_source_id, invoke_owner_id)
        SELECT id, path, timestamp, 2, invoke_source_id, invoke_owner_id FROM images WHERE id='a';
        DELETE FROM collection_images WHERE image_id='a'; DELETE FROM images WHERE id='a';").unwrap();
    check_counts(&conn, &[("a", 1), ("global", 1), ("mixed", 1)]);
    conn.execute_batch("INSERT INTO images (id, path, timestamp, invoke_source_id, invoke_owner_id)
        SELECT id, path, timestamp, invoke_source_id, invoke_owner_id FROM removed_images WHERE id='a';
        DELETE FROM removed_images WHERE id='a';
        INSERT INTO collection_images (collection_id, image_id) VALUES
        ('a', 'a'), ('board', 'a'), ('mixed', 'a'), ('suppressed', 'a'), ('unverified', 'a');").unwrap();
    check_counts(
        &conn,
        &[("a", 2), ("board", 1), ("global", 1), ("mixed", 2)],
    );
    set_scope(&conn, "none", "", false);
    check_counts(&conn, &[("global", 1), ("mixed", 1)]);
}

#[derive(Clone)]
struct Cell {
    name: String,
    primary: bool,
    first: [f64; 3],
    warm: [f64; 3],
    plans_ok: [bool; 3],
}

#[test]
fn query_only_candidates_preserve_a_truly_local_only_library() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn);
    conn.execute_batch("INSERT INTO images (id, path, timestamp) VALUES
        ('local-a', 'C:/Library/a.png', 1), ('local-b', 'C:/Library/b.png', 2);
        INSERT INTO collections (id, name) VALUES ('empty', 'Empty'), ('local', 'Local');
        INSERT INTO collection_images (collection_id, image_id) VALUES ('local', 'local-a'), ('local', 'local-b');").unwrap();
    check_counts(&conn, &[("local", 2)]);
}

fn primary_passes(cells: &[Cell], variant: usize) -> bool {
    let primary: Vec<_> = cells.iter().filter(|cell| cell.primary).collect();
    primary.len() == 2
        && primary.iter().all(|cell| {
            cell.plans_ok[variant]
                && passes_timing_gate(cell.first[0], cell.first[variant], false)
                && passes_timing_gate(cell.warm[0], cell.warm[variant], true)
        })
}

fn winner(cells: &[Cell], complete: bool) -> Option<usize> {
    let mut required = Vec::new();
    for shape in SHAPES {
        for scope in ["none", "all", "owner"] {
            required.push(format!("{}/{scope}/alone", shape.name));
        }
    }
    for scope in ["all", "owner"] {
        required.push(format!("representative/{scope}/concurrent"));
    }
    required.sort_unstable();
    let mut measured: Vec<_> = cells.iter().map(|cell| cell.name.clone()).collect();
    measured.sort_unstable();
    if !complete || measured != required {
        return None;
    }
    let qualifies = |variant| {
        primary_passes(cells, variant)
            && cells.iter().all(|cell| {
                cell.plans_ok[variant]
                    && passes_timing_gate(cell.first[0], cell.first[variant], false)
                    && passes_timing_gate(cell.warm[0], cell.warm[variant], cell.primary)
            })
    };
    let worst = |variant| {
        cells
            .iter()
            .filter(|cell| cell.primary)
            .map(|cell| cell.warm[variant] / cell.warm[0])
            .fold(0.0_f64, f64::max)
    };
    match (qualifies(1), qualifies(2)) {
        (true, true) => Some(if worst(1) <= worst(2) * 1.01 { 1 } else { 2 }),
        (true, false) => Some(1),
        (false, true) => Some(2),
        _ => None,
    }
}

#[test]
fn query_only_selection_never_accepts_missing_or_regressing_cells() {
    let good = Cell {
        name: "representative/all/concurrent".into(),
        primary: true,
        first: [1000., 1050., 695.],
        warm: [1000., 700., 695.],
        plans_ok: [true; 3],
    };
    let mut cells = vec![
        good.clone(),
        Cell {
            name: "representative/owner/concurrent".into(),
            ..good
        },
    ];
    assert_eq!(winner(&cells, false), None);
    assert_eq!(winner(&cells[..1], true), None);
    assert_eq!(
        winner(&cells, true),
        None,
        "primary-only results cannot bypass nonregression coverage"
    );
    for shape in SHAPES {
        for scope in ["none", "all", "owner"] {
            cells.push(Cell {
                name: format!("{}/{scope}/alone", shape.name),
                primary: false,
                first: [10., 20., 20.],
                warm: [10., 20., 20.],
                plans_ok: [true; 3],
            });
        }
    }
    assert_eq!(
        winner(&cells, true),
        Some(1),
        "primary gain is warm-only; first reads need nonregression; within 1% favors the simpler query"
    );
    cells[2].first[1] = 31.;
    assert_eq!(winner(&cells, true), Some(2));
    cells[1].plans_ok[2] = false;
    assert_eq!(winner(&cells, true), None);
}

#[derive(Clone, Copy)]
pub(super) struct Shape {
    pub(super) name: &'static str,
    pub(super) images: usize,
    pub(super) memberships: usize,
}
pub(super) const SHAPES: [Shape; 5] = [
    Shape {
        name: "representative",
        images: 150_000,
        memberships: 132_000,
    },
    Shape {
        name: "overlapping",
        images: 150_000,
        memberships: 250_000,
    },
    Shape {
        name: "sparse",
        images: 150_000,
        memberships: 1_000,
    },
    Shape {
        name: "small",
        images: 10_000,
        memberships: 1_000,
    },
    Shape {
        name: "empty",
        images: 150_000,
        memberships: 0,
    },
];

pub(super) fn seed_catalog(path: &Path, shape: Shape, local_only: bool) {
    let mut conn = Connection::open(path).unwrap();
    migrate(&conn);
    conn.execute_batch(PERFORMANCE_PRAGMAS).unwrap();
    let tx = conn.transaction().unwrap();
    {
        let mut collection = tx
            .prepare(
                "INSERT INTO collections (id, name, source, invoke_source_id, invoke_owner_id)
            VALUES (?1, ?1, 'ambit', ?2, ?3)",
            )
            .unwrap();
        for n in 0..379 {
            let (source, owner) = if local_only {
                (None, None)
            } else {
                match n % 4 {
                    0 => (None, None),
                    1 => (Some("fixture.db"), Some("a")),
                    2 => (Some("fixture.db"), Some("b")),
                    _ => (Some("other.db"), Some("a")),
                }
            };
            collection
                .execute(params![format!("collection-{n:03}"), source, owner])
                .unwrap();
        }
        let padding = format!(
            r#"{{"workflow":"synthetic","padding":"{}"}}"#,
            "x".repeat(2048)
        );
        let mut image = tx.prepare("INSERT INTO images
            (id, path, timestamp, metadata_json, invoke_source_id, invoke_owner_id, invoke_scope_hidden)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").unwrap();
        for n in 0..shape.images {
            let (source, owner) = if local_only {
                (None, None)
            } else {
                match n % 5 {
                    0 => (None, None),
                    1 => (Some("fixture.db"), Some("a")),
                    2 => (Some("fixture.db"), Some("b")),
                    3 => (Some("fixture.db"), None),
                    _ => (Some("other.db"), Some("a")),
                }
            };
            image
                .execute(params![
                    format!("image-{n:06}"),
                    format!("C:/GeneratedLibrary/{n:06}.png"),
                    n as i64,
                    padding,
                    source,
                    owner,
                    i64::from(n % 29 == 0)
                ])
                .unwrap();
        }
        let mut membership = tx
            .prepare("INSERT INTO collection_images (collection_id, image_id) VALUES (?1, ?2)")
            .unwrap();
        for n in 0..shape.memberships {
            // The first image-sized pass is unique; additional passes overlap into another collection.
            let image = n % shape.images;
            let collection = (image + n / shape.images) % 379;
            membership
                .execute(params![
                    format!("collection-{collection:03}"),
                    format!("image-{image:06}")
                ])
                .unwrap();
        }
    }
    tx.commit().unwrap();
    conn.execute_batch("ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
}

const DISCOVERY_SOURCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/services/invoke/connection.ts"
));

fn discovery_sql() -> Vec<String> {
    let source = DISCOVERY_SOURCE.split("const readColumns").next().unwrap();
    let owner_templates: Vec<_> = source
        .split("db.select<OwnerRow[]>(`")
        .skip(1)
        .map(|tail| tail.split('`').next().unwrap())
        .collect();
    assert_eq!(
        owner_templates.len(),
        4,
        "review source discovery branch changes before benchmarking"
    );
    let intermediate = source
        .split("? ', SUM(")
        .nth(1)
        .unwrap()
        .split('\'')
        .next()
        .unwrap();
    let images = owner_templates[0].replace(
        "${intermediateCountSelect}",
        &format!(", SUM({intermediate}"),
    );
    assert!(!images.contains("${"));
    let schema = [
        "PRAGMA table_info(images)",
        "SELECT name FROM sqlite_master WHERE type='table'",
        "PRAGMA table_info(users)",
        "PRAGMA table_info(boards)",
    ];
    for sql in schema {
        assert!(source.contains(sql));
    }
    vec![
        schema[0].into(),
        schema[1].into(),
        schema[2].into(),
        images,
        schema[3].into(),
        owner_templates[2].into(),
    ]
}

fn seed_source(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    conn.execute_batch("CREATE TABLE users (user_id TEXT PRIMARY KEY, display_name TEXT);
        CREATE TABLE images (image_name TEXT PRIMARY KEY, user_id TEXT, is_intermediate INTEGER, metadata_json TEXT);
        CREATE TABLE boards (board_id TEXT PRIMARY KEY, user_id TEXT);
        INSERT INTO users VALUES ('a', 'Synthetic A'), ('b', 'Synthetic B');").unwrap();
    let tx = conn.transaction().unwrap();
    {
        let padding = "x".repeat(2048);
        let mut image = tx
            .prepare("INSERT INTO images VALUES (?1, ?2, ?3, ?4)")
            .unwrap();
        for n in 0..150_000 {
            image
                .execute(params![
                    format!("source-{n:06}.png"),
                    match n % 3 {
                        0 => Some("a"),
                        1 => Some("b"),
                        _ => None,
                    },
                    i64::from(n % 31 == 0),
                    padding
                ])
                .unwrap();
        }
        let mut board = tx.prepare("INSERT INTO boards VALUES (?1, ?2)").unwrap();
        for n in 0..379 {
            board
                .execute(params![
                    format!("board-{n}"),
                    if n % 2 == 0 { "a" } else { "b" }
                ])
                .unwrap();
        }
    }
    tx.commit().unwrap();
}

fn run_discovery(conn: &Connection, queries: &[String]) {
    for query in queries {
        let mut statement = conn.prepare(query).unwrap();
        let columns = statement.column_count();
        let mut rows = statement.query([]).unwrap();
        while let Some(row) = rows.next().unwrap() {
            // Materialize every returned cell, as the frontend SQL adapter does.
            for column in 0..columns {
                std::hint::black_box(row.get::<_, rusqlite::types::Value>(column).unwrap());
            }
        }
    }
}

#[test]
fn query_only_discovery_workload_uses_the_actual_source_summary_sql() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE users (user_id TEXT, display_name TEXT);
        CREATE TABLE images (user_id TEXT, is_intermediate INTEGER); CREATE TABLE boards (user_id TEXT);
        INSERT INTO users VALUES ('a', 'A'); INSERT INTO images VALUES ('a', 0), ('a', 1);
        INSERT INTO boards VALUES ('a');").unwrap();
    let queries = discovery_sql();
    run_discovery(&conn, &queries);
    let actual: (i64, i64) = conn
        .query_row(&queries[3], [], |row| Ok((row.get(2)?, row.get(3)?)))
        .unwrap();
    assert_eq!(actual, (2, 1));
}

fn median(samples: &[f64]) -> f64 {
    let mut sorted = samples.to_vec();
    sorted.sort_by(f64::total_cmp);
    let middle = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    }
}

fn measure(conn: &Connection, sql: &str, source: Option<&Path>) -> (Counts, f64, Option<f64>) {
    std::thread::scope(|thread_scope| {
        let barrier = Arc::new(Barrier::new(2));
        let source_thread = source.map(|path| {
            // Finish fallible setup before spawning, so a setup error cannot strand the barrier.
            let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
            let queries = discovery_sql();
            let barrier = Arc::clone(&barrier);
            thread_scope.spawn(move || {
                barrier.wait();
                let started = Instant::now();
                run_discovery(&conn, &queries);
                started.elapsed().as_secs_f64() * 1000.0
            })
        });
        if source_thread.is_some() {
            barrier.wait();
        }
        let started = Instant::now();
        let mut rows = fetch(conn, sql);
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        rows.sort_unstable();
        let source_elapsed =
            source_thread.map(|thread| thread.join().expect("source discovery thread"));
        (rows, elapsed, source_elapsed)
    })
}

fn measure_cell(path: &Path, shape: Shape, scope: &str, source: Option<&Path>) -> Cell {
    let configure = Connection::open(path).unwrap();
    set_scope(
        &configure,
        scope,
        if scope == "owner" { "a" } else { "" },
        true,
    );
    drop(configure);
    let name = format!(
        "{}/{}/{}",
        shape.name,
        scope,
        if source.is_some() {
            "concurrent"
        } else {
            "alone"
        }
    );
    let mut first: [Vec<f64>; 3] = std::array::from_fn(|_| Vec::new());
    let mut warm: [Vec<f64>; 3] = std::array::from_fn(|_| Vec::new());
    let mut expected = None;
    let mut plans_ok = [true; 3];
    for (round, order) in ORDERS.iter().enumerate() {
        for &variant in order {
            let conn = Connection::open(path).unwrap();
            conn.execute_batch(PERFORMANCE_PRAGMAS).unwrap();
            let mut samples = Vec::new();
            let mut source_samples = Vec::new();
            for sample in 0..6 {
                let (rows, duration, discovery_duration) =
                    measure(&conn, QUERIES[variant].1, source);
                if let Some(expected) = &expected {
                    assert_eq!(&rows, expected, "{name} {}", QUERIES[variant].0);
                } else {
                    expected = Some(rows);
                }
                if sample == 0 {
                    first[variant].push(duration);
                } else {
                    warm[variant].push(duration);
                }
                samples.push(duration);
                source_samples.push(discovery_duration);
            }
            if round == 0 {
                let plan: Vec<String> = conn
                    .prepare(&format!("EXPLAIN QUERY PLAN {}", QUERIES[variant].1))
                    .unwrap()
                    .query_map([], |row| row.get(3))
                    .unwrap()
                    .collect::<Result<_, _>>()
                    .unwrap();
                plans_ok[variant] = plan
                    .iter()
                    .any(|step| step.contains("ci USING") && step.contains("INDEX"))
                    && !plan.iter().any(|step| step.contains("CORRELATED"));
                println!(
                    "QUERY_ONLY_PLAN {}",
                    json!({"cell":name,"variant":QUERIES[variant].0,"accepted":plans_ok[variant],"plan":plan})
                );
            }
            println!(
                "QUERY_ONLY_SAMPLE {}",
                json!({"cell":name,"round":round,"variant":QUERIES[variant].0,
                "count_ms":samples,"source_ms":source_samples})
            );
        }
    }
    let cell = Cell {
        name,
        primary: source.is_some(),
        first: std::array::from_fn(|n| median(&first[n])),
        warm: std::array::from_fn(|n| median(&warm[n])),
        plans_ok,
    };
    println!(
        "QUERY_ONLY_CELL {}",
        json!({"cell":cell.name,"first_ms":cell.first,"warm_ms":cell.warm,"plans_ok":cell.plans_ok})
    );
    cell
}

#[test]
#[ignore = "opt-in generated-only query feasibility benchmark; primary gate rejects without running unnecessary matrix cells"]
fn benchmark_collection_stats_query_only_generated_catalogs() {
    super::sql_plugin_tests::require_pre_m80_campaign();
    assert_eq!(
        normalized(BASELINE),
        normalized(super::tests::production_collection_stats_query())
    );
    println!(
        "QUERY_ONLY_ENV {}",
        json!({"sqlite":rusqlite::version(),"debug_assertions":cfg!(debug_assertions),"pragmas":PERFORMANCE_PRAGMAS,
        "source_connection":"bundled rusqlite read-only defaults","rounds":6,"warm_per_round":5,"os_cold":false})
    );
    let source_dir = GeneratedBenchmarkDir::new();
    let source = source_dir.path.join("generated-source.db");
    seed_source(&source);
    let representative_dir = GeneratedBenchmarkDir::new();
    let representative = representative_dir.path.join("generated-representative.db");
    seed_catalog(&representative, SHAPES[0], false);
    let mut cells = Vec::new();
    for scope in ["all", "owner"] {
        cells.push(measure_cell(
            &representative,
            SHAPES[0],
            scope,
            Some(&source),
        ));
    }
    if !(primary_passes(&cells, 1) || primary_passes(&cells, 2)) {
        assert_eq!(winner(&cells, false), None);
        println!(
            "QUERY_ONLY_RESULT {}",
            json!({"winner":null,"complete_matrix":false,
            "completed_cells":cells.iter().map(|cell| &cell.name).collect::<Vec<_>>(),
            "unrun_cells":15,"reason":"both candidates fail mandatory primary gates; retain production SQL"})
        );
        return;
    }
    for scope in ["all", "owner"] {
        cells.push(measure_cell(&representative, SHAPES[0], scope, None));
    }
    drop(representative_dir);
    for shape in SHAPES {
        if shape.name != "representative" {
            let dir = GeneratedBenchmarkDir::new();
            let path = dir.path.join("generated-scoped.db");
            seed_catalog(&path, shape, false);
            for scope in ["all", "owner"] {
                cells.push(measure_cell(&path, shape, scope, None));
            }
        }
        let local_dir = GeneratedBenchmarkDir::new();
        let local_path = local_dir.path.join("generated-local.db");
        seed_catalog(&local_path, shape, true);
        cells.push(measure_cell(&local_path, shape, "none", None));
    }
    assert_eq!(cells.len(), 17);
    let selected = winner(&cells, true).map(|variant| QUERIES[variant].0);
    println!(
        "QUERY_ONLY_RESULT {}",
        json!({"winner":selected,"complete_matrix":true,"completed_cells":17})
    );
}
