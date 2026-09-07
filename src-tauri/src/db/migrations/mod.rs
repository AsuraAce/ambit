use tauri_plugin_sql::Migration;

mod image_scope_sql;
pub mod legacy;
pub mod m33_denormalize;
pub mod m34_sync;
pub mod m35_thumbs;
pub mod m38_junctions;
pub mod m39_fix_backfill;
pub mod m40_guidance;
pub mod m41_cache;
pub mod m42_facet_guidance;
pub mod m43_parser_version;
pub mod m44_optimize_reparse;
pub mod m45_optimize_triggers;
pub mod m46_optimize_fts;
pub mod m47_facet_cleanup;
pub mod m48_original_parsed;
pub mod m49_removed_images;
pub mod m50_privacy_index;
pub mod m51_file_hash;
pub mod m52_thumbnail_privacy;
pub mod m53_live_facet_indexes;
pub mod m54_resource_junction_covering_indexes;
pub mod m55_manual_thumbnail_lookup_index;
pub mod m56_thumbnail_optimization;
pub mod m57_collection_thumbnail_cache;
pub mod m58_nullable_seed;
pub mod m59_canonical_resource_lookup_indexes;
pub mod m60_resource_inventory_cleanup;
pub mod m61_auxiliary_resource_inventory_cleanup;
pub mod m62_smart_collection_count_cache;
pub mod m63_invoke_image_source;
pub mod m64_invoke_image_references;
pub mod m65_invoke_owner_scope;
pub mod m66_invoke_collection_owner;
pub mod m67_removed_restore_state;
pub mod m68_video_library_assets;
pub mod m69_invoke_scope_cache;
pub mod m70_invoke_scoped_views;
pub mod m71_invoke_scope_dirty_items;
pub mod m72_invoke_scope_dirty_conflicts;
pub mod m73_ambit_collection_scope;
pub mod m74_invoke_scope_literal_prefix;
pub mod m75_owner_scope_review;
pub mod m76_invoke_collection_ownership;
pub mod m77_removed_invoke_identity_index;
pub mod m78_thumbnail_retry_invalidation;
pub mod m79_thumbnail_repair_candidates;
pub mod m80_maintenance_count_indexes;

pub fn init_db() -> Vec<Migration> {
    get_migrations()
}

pub fn get_migrations() -> Vec<Migration> {
    let mut migrations = legacy::get_legacy_migrations();

    // Core migrations (previously version 33-35, 38-41)
    migrations.push(m33_denormalize::migration33());
    migrations.push(m34_sync::migration34());
    migrations.push(m35_thumbs::migration35());
    // Note: Version 37 (retry of 36) is in legacy.rs
    migrations.push(m38_junctions::migration38());
    migrations.push(m39_fix_backfill::migration39());
    migrations.push(m40_guidance::migration40());
    migrations.push(m41_cache::migration41());
    migrations.push(m42_facet_guidance::migration42());
    migrations.push(m43_parser_version::migration43());
    migrations.push(m44_optimize_reparse::migration44());
    migrations.push(m45_optimize_triggers::migration45());
    migrations.push(m46_optimize_fts::migration46());
    migrations.push(m47_facet_cleanup::migration47());
    migrations.push(m48_original_parsed::migration48());
    migrations.push(m49_removed_images::migration49());
    migrations.push(m50_privacy_index::migration50());
    migrations.push(m51_file_hash::migration51());
    migrations.push(m52_thumbnail_privacy::migration52());
    migrations.push(m53_live_facet_indexes::migration53());
    migrations.push(m54_resource_junction_covering_indexes::migration54());
    migrations.push(m55_manual_thumbnail_lookup_index::migration55());
    migrations.push(m56_thumbnail_optimization::migration56());
    migrations.push(m57_collection_thumbnail_cache::migration57());
    migrations.push(m58_nullable_seed::migration58());
    migrations.push(m59_canonical_resource_lookup_indexes::migration59());
    migrations.push(m60_resource_inventory_cleanup::migration60());
    migrations.push(m61_auxiliary_resource_inventory_cleanup::migration61());
    migrations.push(m62_smart_collection_count_cache::migration62());
    migrations.push(m63_invoke_image_source::migration63());
    migrations.push(m64_invoke_image_references::migration64());
    migrations.push(m65_invoke_owner_scope::migration65());
    migrations.push(m66_invoke_collection_owner::migration66());
    migrations.push(m67_removed_restore_state::migration67());
    migrations.push(m68_video_library_assets::migration68());
    migrations.push(m69_invoke_scope_cache::migration69());
    migrations.push(m70_invoke_scoped_views::migration70());
    migrations.push(m71_invoke_scope_dirty_items::migration71());
    migrations.push(m72_invoke_scope_dirty_conflicts::migration72());
    migrations.push(m73_ambit_collection_scope::migration73());
    migrations.push(m74_invoke_scope_literal_prefix::migration74());
    migrations.push(m75_owner_scope_review::migration75());
    migrations.push(m76_invoke_collection_ownership::migration76());
    migrations.push(m77_removed_invoke_identity_index::migration77());
    migrations.push(m78_thumbnail_retry_invalidation::migration78());
    migrations.push(m79_thumbnail_repair_candidates::migration79());
    migrations.push(m80_maintenance_count_indexes::migration80());

    migrations.sort_by_key(|m| m.version);

    migrations
}

#[cfg(test)]
mod collection_stats_query_tests;

#[cfg(test)]
mod sql_plugin_tests;

#[cfg(test)]
mod sql_plugin_runtime_tests;

#[cfg(test)]
mod tests {
    use super::get_migrations;
    use rusqlite::{params, Connection};

    const COLLECTION_REPO_SOURCE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../src/services/db/collectionRepo.ts"
    ));

    pub(super) fn production_collection_stats_query() -> &'static str {
        let start = COLLECTION_REPO_SOURCE
            .find("`SELECT ci.collection_id, COUNT(*) as count")
            .expect("collection stats query in collectionRepo.ts")
            + 1;
        let end = start
            + COLLECTION_REPO_SOURCE[start..]
                .find('`')
                .expect("end of collection stats query in collectionRepo.ts");
        &COLLECTION_REPO_SOURCE[start..end]
    }

    #[test]
    fn migrations_include_mainline_through_maintenance_count_indexes_80() {
        let versions: Vec<i64> = get_migrations()
            .iter()
            .map(|migration| migration.version)
            .collect();

        assert!(versions.contains(&49));
        assert!(versions.contains(&50));
        assert!(versions.contains(&51));
        assert!(versions.contains(&52));
        assert!(versions.contains(&53));
        assert!(versions.contains(&54));
        assert!(versions.contains(&55));
        assert!(versions.contains(&56));
        assert!(versions.contains(&57));
        assert!(versions.contains(&58));
        assert!(versions.contains(&59));
        assert!(versions.contains(&60));
        assert!(versions.contains(&61));
        assert!(versions.contains(&62));
        assert!(versions.contains(&63));
        assert!(versions.contains(&64));
        assert!(versions.contains(&65));
        assert!(versions.contains(&66));
        assert!(versions.contains(&67));
        assert!(versions.contains(&68));
        assert!(versions.contains(&69));
        assert!(versions.contains(&70));
        assert!(versions.contains(&71));
        assert!(versions.contains(&72));
        assert!(versions.contains(&73));
        assert!(versions.contains(&74));
        assert!(versions.contains(&75));
        assert!(versions.contains(&76));
        assert!(versions.contains(&77));
        assert!(versions.contains(&78));
        assert!(versions.contains(&79));
        assert!(versions.contains(&80));
    }

    #[test]
    fn migrations_are_sorted_by_version() {
        let versions: Vec<i64> = get_migrations()
            .iter()
            .map(|migration| migration.version)
            .collect();
        let mut sorted = versions.clone();
        sorted.sort_unstable();
        let mut unique = sorted.clone();
        unique.dedup();

        assert_eq!(versions, sorted);
        assert_eq!(
            versions.len(),
            unique.len(),
            "migration versions must be unique"
        );
    }

    #[test]
    fn migration_49_matches_mainline_description() {
        let migration_49 = get_migrations()
            .into_iter()
            .find(|migration| migration.version == 49)
            .expect("migration 49 should be registered");

        assert_eq!(migration_49.description, "add_removed_images_tombstones");
    }

    #[test]
    fn database_at_mainline_49_has_migrations_through_maintenance_count_indexes_80_pending() {
        let migrations = get_migrations();
        let has_49 = migrations.iter().any(|migration| migration.version == 49);
        let pending_after_49: Vec<i64> = migrations
            .iter()
            .filter(|migration| migration.version > 49)
            .map(|migration| migration.version)
            .collect();

        assert!(has_49);
        assert_eq!(
            pending_after_49,
            vec![
                50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70,
                71, 72, 73, 74, 75, 76, 77, 78, 79, 80
            ]
        );
    }

    #[test]
    fn removed_invoke_identity_lookup_uses_image_name_index() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        for migration in get_migrations() {
            conn.execute_batch(&migration.sql)
                .unwrap_or_else(|error| panic!("apply migration {}: {error}", migration.version));
        }

        let plan = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT DISTINCT removed_images.invoke_source_id,
                                 scope.db_path,
                                 removed_images.invoke_image_name
                 FROM removed_images AS removed_images
                 JOIN invoke_owner_scope_state AS scope ON scope.state_key = 'current'
                 WHERE removed_images.invoke_source_id IS NOT NULL
                   AND removed_images.invoke_image_name IN ('one.png', 'two.png')
                   AND removed_images.invoke_scope_hidden = 0
                   AND (
                       scope.scope_mode IN ('legacy', 'all')
                       OR (
                           scope.scope_mode = 'owner'
                           AND (
                               removed_images.invoke_owner_id IS NULL
                               OR removed_images.invoke_owner_id = scope.owner_id
                           )
                       )
                   )",
            )
            .expect("prepare identity lookup plan")
            .query_map([], |row| row.get::<_, String>(3))
            .expect("read identity lookup plan")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect identity lookup plan");

        assert!(
            plan.iter().any(|detail| {
                detail.contains("idx_removed_images_invoke_name_scope_source_owner")
            }),
            "Removed Invoke identity lookup should use its image-name index: {plan:?}"
        );
    }

    #[test]
    fn migrated_collection_stats_query_scopes_collections_before_memberships() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        for migration in get_migrations() {
            conn.execute_batch(&migration.sql)
                .unwrap_or_else(|error| panic!("apply migration {}: {error}", migration.version));
        }
        conn.execute_batch(
            r#"
            INSERT INTO invoke_owner_scope_state (
                state_key, db_path, images_root, scope_mode, owner_id, updated_at, boards_verified
            ) VALUES ('current', 'fixture.db', 'C:/Fixture', 'owner', 'owner-a', 1, 1);

            INSERT INTO images (
                id, path, timestamp, invoke_source_id, invoke_owner_id, invoke_scope_hidden
            ) VALUES
                ('owner-a-1', 'C:/Fixture/outputs/images/a1.png', 1, 'fixture.db', 'owner-a', 0),
                ('owner-a-2', 'C:/Fixture/outputs/images/a2.png', 2, 'fixture.db', 'owner-a', 0),
                ('shared-image', 'C:/Library/shared.png', 3, NULL, NULL, 0);

            INSERT INTO collections (id, name, source, invoke_source_id, invoke_owner_id) VALUES
                ('visible-owner', 'Visible owner collection', 'ambit', 'fixture.db', 'owner-a'),
                ('shared', 'Shared collection', 'ambit', NULL, NULL),
                ('hidden-owner', 'Other owner collection', 'ambit', 'fixture.db', 'owner-b');

            INSERT INTO collection_images (collection_id, image_id) VALUES
                ('visible-owner', 'owner-a-1'),
                ('visible-owner', 'owner-a-2'),
                ('shared', 'shared-image'),
                ('hidden-owner', 'owner-a-1');

            WITH RECURSIVE image_numbers(n) AS (
                VALUES(1)
                UNION ALL
                SELECT n + 1 FROM image_numbers WHERE n < 5000
            )
            INSERT INTO images (id, path, timestamp, invoke_scope_hidden)
            SELECT
                'unrelated-' || n,
                'C:/Library/unrelated-' || n || '.png',
                n + 10,
                0
            FROM image_numbers;
            ANALYZE;
            "#,
        )
        .expect("seed owner-scoped collection stats fixture");

        let query = production_collection_stats_query();
        assert!(query.contains("FROM scoped_collections c"));

        let counts: Vec<(String, i64)> = conn
            .prepare(&format!("{query} ORDER BY ci.collection_id"))
            .expect("production collection stats query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("production collection stats rows")
            .collect::<Result<_, _>>()
            .expect("production collection stats");
        assert_eq!(
            counts,
            vec![("shared".into(), 1), ("visible-owner".into(), 2)],
            "the active owner sees its own and shared collections, never another owner's membership"
        );

        let plan: Vec<String> = conn
            .prepare(&format!("EXPLAIN QUERY PLAN {query}"))
            .expect("production collection stats plan")
            .query_map([], |row| row.get(3))
            .expect("production collection stats plan rows")
            .collect::<Result<_, _>>()
            .expect("production collection stats plan details");
        assert!(
            plan.iter()
                .any(|detail| detail.contains("idx_collection_images_by_collection")),
            "collection stats must traverse memberships by collection: {plan:?}"
        );
        assert!(
            plan.iter().any(|detail| {
                detail.contains("SEARCH i USING INDEX sqlite_autoindex_images_1")
                    && detail.contains("id=?")
            }),
            "collection stats must reach each image by primary-key lookup: {plan:?}"
        );
        assert!(
            plan.iter()
                .all(|detail| !detail.contains("SCAN i") && !detail.contains("SCAN images")),
            "collection stats must not scan the image library: {plan:?}"
        );
    }

    #[test]
    fn collection_stats_preserve_no_scope_all_users_and_selected_owner_counts() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        for migration in get_migrations() {
            conn.execute_batch(&migration.sql)
                .unwrap_or_else(|error| panic!("apply migration {}: {error}", migration.version));
        }
        conn.execute_batch(
            r#"
            INSERT INTO images (
                id, path, timestamp, invoke_source_id, invoke_owner_id, invoke_scope_hidden
            ) VALUES
                ('local-visible', 'C:/Library/local-visible.png', 1, NULL, NULL, 0),
                ('local-hidden', 'C:/Library/local-hidden.png', 2, NULL, NULL, 1),
                ('owner-a-visible', 'C:/Fixture/a-visible.png', 3, 'fixture.db', 'owner-a', 0),
                ('owner-a-hidden', 'C:/Fixture/a-hidden.png', 4, 'fixture.db', 'owner-a', 1),
                ('owner-b-visible', 'C:/Fixture/b-visible.png', 5, 'fixture.db', 'owner-b', 0),
                ('other-source', 'D:/Other/other.png', 6, 'other.db', 'owner-a', 0);

            INSERT INTO collections (id, name, source, invoke_source_id, invoke_owner_id) VALUES
                ('global', 'Global', 'ambit', NULL, NULL),
                ('owner-a', 'Owner A', 'ambit', 'fixture.db', 'owner-a'),
                ('owner-b', 'Owner B', 'ambit', 'fixture.db', 'owner-b'),
                ('empty-owner-a', 'Empty owner A', 'ambit', 'fixture.db', 'owner-a'),
                ('mixed', 'Mixed', 'ambit', NULL, NULL);

            INSERT INTO collection_images (collection_id, image_id) VALUES
                ('global', 'local-visible'),
                ('global', 'local-hidden'),
                ('owner-a', 'local-visible'),
                ('owner-a', 'owner-a-visible'),
                ('owner-a', 'owner-a-hidden'),
                ('owner-b', 'owner-b-visible'),
                ('mixed', 'local-visible'),
                ('mixed', 'owner-a-visible'),
                ('mixed', 'owner-b-visible'),
                ('mixed', 'owner-a-hidden'),
                ('mixed', 'other-source');
            ANALYZE;
            "#,
        )
        .expect("seed collection stats scope fixture");

        let query = production_collection_stats_query();
        let scope_cases = [
            ("no scope", None, None, vec![("global", 1), ("mixed", 1)]),
            (
                "all users",
                Some("all"),
                None,
                vec![("global", 1), ("mixed", 3), ("owner-a", 2), ("owner-b", 1)],
            ),
            (
                "owner-a",
                Some("owner"),
                Some("owner-a"),
                vec![("global", 1), ("mixed", 2), ("owner-a", 2)],
            ),
        ];

        for (label, scope_mode, owner_id, expected) in scope_cases {
            conn.execute("DELETE FROM invoke_owner_scope_state", [])
                .expect("clear scope state");
            if let Some(scope_mode) = scope_mode {
                conn.execute(
                    "INSERT INTO invoke_owner_scope_state (
                        state_key, db_path, images_root, scope_mode, owner_id, updated_at, boards_verified
                    ) VALUES ('current', 'fixture.db', 'C:/Fixture', ?1, ?2, 1, 1)",
                    params![scope_mode, owner_id],
                )
                .expect("set scope state");
            }

            let observed: Vec<(String, i64)> = conn
                .prepare(&format!("{query} ORDER BY ci.collection_id"))
                .expect("prepare production collection stats query")
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .expect("read production collection stats rows")
                .collect::<Result<_, _>>()
                .expect("collect production collection stats");
            let expected: Vec<(String, i64)> = expected
                .into_iter()
                .map(|(collection_id, count)| (collection_id.to_string(), count))
                .collect();
            assert_eq!(
                observed, expected,
                "{label} scope must preserve collection counts"
            );
        }
    }

    #[test]
    #[ignore = "opt-in against a real local database via AMBIT_COLLECTION_STATS_DB"]
    fn measure_collection_stats_query_on_real_database_read_only() {
        let path = std::env::var_os("AMBIT_COLLECTION_STATS_DB")
            .expect("set AMBIT_COLLECTION_STATS_DB to run this read-only probe");
        let conn = Connection::open_with_flags(
            std::path::PathBuf::from(path),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .expect("open collection stats database read-only");
        let query = production_collection_stats_query();
        let membership_first = query.replacen(
            "FROM scoped_collections c\n         JOIN collection_images ci ON ci.collection_id = c.id",
            "FROM collection_images ci\n         JOIN scoped_collections c ON c.id = ci.collection_id",
            1,
        );

        for (label, sql) in [
            ("production", query),
            ("membership-first", membership_first.as_str()),
        ] {
            let plan: Vec<String> = conn
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("prepare collection stats query plan")
                .query_map([], |row| row.get(3))
                .expect("read collection stats query plan")
                .collect::<Result<_, _>>()
                .expect("collect collection stats query plan");
            println!("{label} plan={plan:?}");

            for read in 1..=3 {
                let started = std::time::Instant::now();
                let row_count = conn
                    .prepare(sql)
                    .expect("prepare collection stats query")
                    .query_map([], |_| Ok(()))
                    .expect("read collection stats rows")
                    .collect::<Result<Vec<_>, _>>()
                    .expect("complete collection stats read")
                    .len();
                println!(
                    "{label} read={read} rows={row_count} elapsed_ms={}",
                    started.elapsed().as_secs_f64() * 1000.0
                );
            }
        }
    }

    fn collection_stats_rows(conn: &Connection, query: &str) -> Vec<(String, i64)> {
        conn.prepare(query)
            .expect("prepare collection stats query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("read collection stats rows")
            .collect::<Result<_, _>>()
            .expect("collect collection stats rows")
    }

    fn timed_collection_stats_rows(
        conn: &Connection,
        query: &str,
    ) -> (Vec<(String, i64)>, std::time::Duration) {
        let started = std::time::Instant::now();
        let mut rows = collection_stats_rows(conn, query);
        let elapsed = started.elapsed();
        // Compare rows independent of planner output order without changing
        // the production SQL or including comparison work in its timing.
        rows.sort_unstable();
        (rows, elapsed)
    }

    fn seed_collection_scope_benchmark_catalog(path: &std::path::Path, image_count: usize) {
        let mut conn = Connection::open(path).expect("open synthetic catalog");
        conn.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=OFF;")
            .expect("configure synthetic catalog");
        for migration in get_migrations()
            .into_iter()
            .filter(|migration| migration.version < 80)
        {
            conn.execute_batch(&migration.sql)
                .unwrap_or_else(|error| panic!("apply migration {}: {error}", migration.version));
        }
        conn.execute(
            "INSERT INTO invoke_owner_scope_state (
                state_key, db_path, images_root, scope_mode, owner_id, updated_at, boards_verified
            ) VALUES ('current', 'fixture.db', 'C:/Synthetic', 'owner', 'owner-a', 1, 1)",
            [],
        )
        .expect("set synthetic owner scope");
        conn.execute_batch(
            "INSERT INTO collections (id, name, source, invoke_source_id, invoke_owner_id) VALUES
                ('global', 'Global', 'ambit', NULL, NULL),
                ('owner-a', 'Owner A', 'ambit', 'fixture.db', 'owner-a'),
                ('mixed', 'Mixed', 'ambit', NULL, NULL);",
        )
        .expect("seed synthetic collections");

        let metadata_json = format!(
            r#"{{"workflow":"synthetic","padding":"{}"}}"#,
            "x".repeat(2_048)
        );
        let tx = conn
            .transaction()
            .expect("begin synthetic catalog transaction");
        {
            let mut insert_image = tx
                .prepare(
                    "INSERT INTO images (
                        id, path, timestamp, metadata_json, invoke_source_id, invoke_owner_id, invoke_scope_hidden
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )
                .expect("prepare synthetic image insert");
            let mut insert_membership = tx
                .prepare("INSERT INTO collection_images (collection_id, image_id) VALUES (?1, ?2)")
                .expect("prepare synthetic membership insert");
            for ordinal in 0..image_count {
                let id = format!("synthetic-{ordinal:06}");
                let (source, owner) = match ordinal % 3 {
                    0 => (None, None),
                    1 => (Some("fixture.db"), Some("owner-a")),
                    _ => (Some("other.db"), Some("owner-b")),
                };
                insert_image
                    .execute(params![
                        id,
                        format!("C:/Synthetic/{ordinal:06}.png"),
                        ordinal as i64,
                        metadata_json,
                        source,
                        owner,
                        i64::from(ordinal % 29 == 0),
                    ])
                    .expect("insert synthetic image");
                insert_membership
                    .execute(params!["mixed", format!("synthetic-{ordinal:06}")])
                    .expect("insert mixed membership");
                match ordinal % 3 {
                    0 => insert_membership
                        .execute(params!["global", format!("synthetic-{ordinal:06}")])
                        .expect("insert global membership"),
                    1 => insert_membership
                        .execute(params!["owner-a", format!("synthetic-{ordinal:06}")])
                        .expect("insert owner membership"),
                    _ => 0,
                };
            }
        }
        tx.commit().expect("commit synthetic catalog");
        conn.execute_batch("ANALYZE;")
            .expect("analyze synthetic catalog");
    }

    fn measure_collection_scope_write_cost(conn: &mut Connection) -> std::time::Duration {
        let started = std::time::Instant::now();
        let tx = conn
            .transaction()
            .expect("begin synthetic write measurement");
        {
            let mut insert_image = tx
                .prepare(
                    "INSERT INTO images (
                        id, path, timestamp, invoke_source_id, invoke_owner_id, invoke_scope_hidden
                    ) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                )
                .expect("prepare synthetic write insert");
            for ordinal in 0..1_000 {
                insert_image
                    .execute(params![
                        format!("write-measure-{ordinal:04}"),
                        format!("C:/Synthetic/write-{ordinal:04}.png"),
                        ordinal as i64,
                        "fixture.db",
                        "owner-a",
                    ])
                    .expect("insert synthetic write row");
            }
        }
        {
            let mut update_scope = tx
                .prepare("UPDATE images SET invoke_owner_id = ?1 WHERE id = ?2")
                .expect("prepare synthetic write update");
            for ordinal in 0..1_000 {
                update_scope
                    .execute(params![
                        if ordinal % 2 == 0 {
                            "owner-b"
                        } else {
                            "owner-a"
                        },
                        format!("synthetic-{ordinal:06}"),
                    ])
                    .expect("update synthetic write row");
            }
        }
        tx.rollback().expect("rollback synthetic write measurement");
        started.elapsed()
    }

    pub(super) struct GeneratedBenchmarkDir {
        pub(super) path: std::path::PathBuf,
        temp_root: std::path::PathBuf,
        cleanup_observed: bool,
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub(super) enum GeneratedCleanupOutcome {
        Removed,
        AlreadyAbsent,
        RetainedForSafety,
        Failed,
        Unobserved,
    }

    impl GeneratedBenchmarkDir {
        pub(super) fn new() -> Self {
            Self::try_new().expect("create benchmark directory")
        }

        pub(super) fn try_new() -> std::io::Result<Self> {
            let temp_root = std::env::temp_dir().canonicalize()?;
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time after Unix epoch")
                .as_nanos();
            for attempt in 0..100 {
                let path = temp_root.join(format!(
                    "ambit-collection-index-benchmark-{}-{nonce}-{attempt}",
                    std::process::id()
                ));
                match std::fs::create_dir(&path) {
                    Ok(()) => {
                        let canonical_path = path.canonicalize()?;
                        assert_eq!(
                            canonical_path.parent(),
                            Some(temp_root.as_path()),
                            "benchmark directory must be a direct system-temp child"
                        );
                        return Ok(Self {
                            path,
                            temp_root,
                            cleanup_observed: false,
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(error),
                }
            }
            Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "could not create a unique benchmark directory",
            ))
        }

        pub(super) fn cleanup(&mut self) -> GeneratedCleanupOutcome {
            self.cleanup_with(|path| std::fs::remove_dir_all(path))
        }

        fn cleanup_with<F>(&mut self, remove: F) -> GeneratedCleanupOutcome
        where
            F: FnOnce(&std::path::Path) -> std::io::Result<()>,
        {
            if self.cleanup_observed {
                return GeneratedCleanupOutcome::Unobserved;
            }
            self.cleanup_observed = true;
            match std::fs::symlink_metadata(&self.path) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return GeneratedCleanupOutcome::AlreadyAbsent;
                }
                Err(_) => return GeneratedCleanupOutcome::Failed,
                Ok(metadata) => {
                    if metadata.file_type().is_symlink() || !metadata.is_dir() {
                        return GeneratedCleanupOutcome::RetainedForSafety;
                    }
                    #[cfg(windows)]
                    {
                        use std::os::windows::fs::MetadataExt;
                        if metadata.file_attributes() & 0x400 != 0 {
                            return GeneratedCleanupOutcome::RetainedForSafety;
                        }
                    }
                }
            }
            let can_remove = self.path.canonicalize().ok().is_some_and(|path| {
                path.parent() == Some(self.temp_root.as_path()) && !contains_reparse_point(&path)
            });
            if !can_remove {
                return GeneratedCleanupOutcome::RetainedForSafety;
            }
            match remove(&self.path) {
                Ok(()) => GeneratedCleanupOutcome::Removed,
                Err(_) => GeneratedCleanupOutcome::Failed,
            }
        }
    }

    fn contains_reparse_point(path: &std::path::Path) -> bool {
        let metadata = match std::fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(_) => return true,
        };
        if metadata.file_type().is_symlink() {
            return true;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return true;
            }
        }
        if metadata.is_dir() {
            let mut entries = match std::fs::read_dir(path) {
                Ok(entries) => entries,
                Err(_) => return true,
            };
            return entries.any(|entry| match entry {
                Ok(entry) => contains_reparse_point(&entry.path()),
                Err(_) => true,
            });
        }
        false
    }

    impl Drop for GeneratedBenchmarkDir {
        fn drop(&mut self) {
            if !self.cleanup_observed {
                match self.cleanup() {
                    GeneratedCleanupOutcome::Removed | GeneratedCleanupOutcome::AlreadyAbsent => {}
                    GeneratedCleanupOutcome::RetainedForSafety => {
                        eprintln!(
                            "benchmark cleanup retained unsafe path {}",
                            self.path.display()
                        );
                    }
                    GeneratedCleanupOutcome::Failed => {
                        eprintln!("benchmark cleanup retained {}", self.path.display());
                    }
                    GeneratedCleanupOutcome::Unobserved => {}
                }
            }
        }
    }

    #[test]
    fn generated_benchmark_cleanup_is_guarded_observed_and_never_retried() {
        let mut removed = GeneratedBenchmarkDir::new();
        let removed_path = removed.path.clone();
        assert_eq!(removed.cleanup(), GeneratedCleanupOutcome::Removed);
        assert!(
            !removed_path.exists(),
            "guarded generated directory is removed"
        );
        assert_eq!(removed.cleanup(), GeneratedCleanupOutcome::Unobserved);

        let mut absent = GeneratedBenchmarkDir::new();
        std::fs::remove_dir_all(&absent.path).expect("remove owned generated directory");
        assert_eq!(absent.cleanup(), GeneratedCleanupOutcome::AlreadyAbsent);
        assert_eq!(absent.cleanup(), GeneratedCleanupOutcome::Unobserved);

        let mut retained = GeneratedBenchmarkDir::new();
        std::fs::remove_dir(&retained.path).expect("empty owned generated directory");
        std::fs::write(&retained.path, b"not-a-directory").expect("replace owned root with file");
        assert_eq!(
            retained.cleanup(),
            GeneratedCleanupOutcome::RetainedForSafety,
            "a replaced generated root is never followed or removed"
        );
        assert!(retained.path.is_file(), "unsafe root stays untouched");
        assert_eq!(retained.cleanup(), GeneratedCleanupOutcome::Unobserved);
        std::fs::remove_file(&retained.path).expect("remove owned safety-test file");

        let mut failed = GeneratedBenchmarkDir::new();
        let failed_path = failed.path.clone();
        assert_eq!(
            failed.cleanup_with(|_| Err(std::io::Error::from_raw_os_error(5))),
            GeneratedCleanupOutcome::Failed
        );
        assert!(
            failed_path.exists(),
            "failed cleanup does not claim removal"
        );
        assert_eq!(failed.cleanup(), GeneratedCleanupOutcome::Unobserved);
        std::fs::remove_dir_all(&failed_path).expect("remove owned failed-cleanup directory");
    }

    #[cfg(windows)]
    #[test]
    fn generated_benchmark_cleanup_rejects_directory_redirection_without_touching_target() {
        let target = GeneratedBenchmarkDir::new();
        let sentinel = target.path.join("sentinel.txt");
        std::fs::write(&sentinel, b"generated target sentinel").expect("write generated sentinel");
        let mut redirected = GeneratedBenchmarkDir::new();
        std::fs::remove_dir(&redirected.path).expect("empty generated redirect root");
        let junction = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                "& { param([string]$Path, [string]$Target); New-Item -ItemType Junction -Path $Path -Target $Target -ErrorAction Stop | Out-Null }",
            ])
            .arg(&redirected.path)
            .arg(&target.path)
            .status()
            .expect("generated-junction-creation-blocked");
        assert!(junction.success(), "generated-junction-creation-blocked");

        assert_eq!(
            redirected.cleanup(),
            GeneratedCleanupOutcome::RetainedForSafety,
            "a generated root redirection is retained rather than followed"
        );
        assert!(
            sentinel.is_file(),
            "cleanup never touches the redirection target"
        );
        assert_eq!(redirected.cleanup(), GeneratedCleanupOutcome::Unobserved);
        std::fs::remove_dir(&redirected.path).expect("remove generated link without recursing");
        assert!(sentinel.is_file(), "removing the link preserves its target");
    }

    #[cfg(unix)]
    #[test]
    fn generated_benchmark_cleanup_rejects_directory_redirection_without_touching_target() {
        use std::os::unix::fs::symlink;

        let target = GeneratedBenchmarkDir::new();
        let sentinel = target.path.join("sentinel.txt");
        std::fs::write(&sentinel, b"generated target sentinel").expect("write generated sentinel");
        let mut redirected = GeneratedBenchmarkDir::new();
        std::fs::remove_dir(&redirected.path).expect("empty generated redirect root");
        symlink(&target.path, &redirected.path).expect("create generated directory symlink");

        assert_eq!(
            redirected.cleanup(),
            GeneratedCleanupOutcome::RetainedForSafety
        );
        assert!(
            sentinel.is_file(),
            "cleanup never touches the redirection target"
        );
        assert_eq!(redirected.cleanup(), GeneratedCleanupOutcome::Unobserved);
        std::fs::remove_file(&redirected.path).expect("remove generated link without recursing");
        assert!(sentinel.is_file(), "removing the link preserves its target");
    }

    struct CollectionScopeBenchmarkMeasurement {
        label: &'static str,
        rows: Vec<(String, i64)>,
        first_read: std::time::Duration,
        warm_reads: Vec<std::time::Duration>,
        index_build: std::time::Duration,
        index_bytes: u64,
        write_costs: Vec<std::time::Duration>,
        plan: Vec<String>,
    }

    fn run_collection_scope_benchmark_variant(
        benchmark_dir: &GeneratedBenchmarkDir,
        catalog_path: &std::path::Path,
        catalog_bytes: u64,
        label: &'static str,
        index_sql: Option<&str>,
        query: &str,
    ) -> CollectionScopeBenchmarkMeasurement {
        let variant_path = benchmark_dir.path.join(format!("{label}.db"));
        std::fs::copy(catalog_path, &variant_path).expect("copy synthetic catalog");
        let mut conn = Connection::open(&variant_path).expect("open synthetic variant");
        let index_build_started = std::time::Instant::now();
        if let Some(index_sql) = index_sql {
            conn.execute_batch(index_sql)
                .expect("create benchmark index");
        }
        let index_build = index_build_started.elapsed();
        let index_bytes = std::fs::metadata(&variant_path)
            .expect("synthetic variant metadata")
            .len()
            .saturating_sub(catalog_bytes);
        let (rows, first_read) = timed_collection_stats_rows(&conn, query);
        let warm_reads = (0..5)
            .map(|_| timed_collection_stats_rows(&conn, query).1)
            .collect();
        let write_costs = (0..3)
            .map(|_| measure_collection_scope_write_cost(&mut conn))
            .collect();
        let plan = conn
            .prepare(&format!("EXPLAIN QUERY PLAN {query}"))
            .expect("prepare benchmark plan")
            .query_map([], |row| row.get(3))
            .expect("read benchmark plan")
            .collect::<Result<_, _>>()
            .expect("collect benchmark plan");
        drop(conn);
        std::fs::remove_file(&variant_path).expect("remove generated benchmark variant");
        CollectionScopeBenchmarkMeasurement {
            label,
            rows,
            first_read,
            warm_reads,
            index_build,
            index_bytes,
            write_costs,
            plan,
        }
    }

    fn median_ms(durations: &[std::time::Duration]) -> f64 {
        let mut values: Vec<f64> = durations
            .iter()
            .map(|duration| duration.as_secs_f64() * 1_000.0)
            .collect();
        values.sort_by(f64::total_cmp);
        let middle = values.len() / 2;
        if values.len() % 2 == 0 {
            (values[middle - 1] + values[middle]) / 2.0
        } else {
            values[middle]
        }
    }

    #[test]
    #[ignore = "opt-in rejected-index experiment: creates a 150k-row synthetic catalog; covering-plan gate is expected to fail"]
    fn benchmark_collection_scope_covering_index_on_synthetic_catalog() {
        const IMAGE_COUNT: usize = 150_000;
        const CANDIDATE_SQL: &str = "
            CREATE INDEX idx_images_collection_scope_covering_v1
                ON images(id, invoke_source_id, invoke_owner_id, invoke_scope_hidden);
            ANALYZE idx_images_collection_scope_covering_v1;
        ";
        let benchmark_dir = GeneratedBenchmarkDir::new();
        let catalog_path = benchmark_dir.path.join("catalog-before-m80.db");
        eprintln!("collection-index benchmark: seeding {IMAGE_COUNT} generated images");
        seed_collection_scope_benchmark_catalog(&catalog_path, IMAGE_COUNT);
        eprintln!("collection-index benchmark: seed complete; measuring alternating variants");
        let catalog_bytes = std::fs::metadata(&catalog_path)
            .expect("synthetic catalog metadata")
            .len();
        let query = production_collection_stats_query();
        let variants = [("baseline", None), ("id-covering", Some(CANDIDATE_SQL))];
        let mut measurements = Vec::new();
        for round in 0..2 {
            let order = if round == 0 { [0, 1] } else { [1, 0] };
            for variant in order {
                let (label, index_sql) = variants[variant];
                eprintln!("collection-index benchmark: round {} {label}", round + 1);
                measurements.push(run_collection_scope_benchmark_variant(
                    &benchmark_dir,
                    &catalog_path,
                    catalog_bytes,
                    label,
                    index_sql,
                    query,
                ));
            }
        }
        let expected_rows = &measurements[0].rows;
        for measurement in &measurements {
            println!(
                "collection-index benchmark round sample {}: rows={} first_ms={:.3} warm_ms={:?} index_build_ms={:.3} index_bytes={} write_2k_ops_ms={:?} plan={:?}",
                measurement.label,
                measurement.rows.iter().map(|(_, count)| count).sum::<i64>(),
                measurement.first_read.as_secs_f64() * 1_000.0,
                measurement.warm_reads.iter().map(|duration| duration.as_secs_f64() * 1_000.0).collect::<Vec<_>>(),
                measurement.index_build.as_secs_f64() * 1_000.0,
                measurement.index_bytes,
                measurement.write_costs.iter().map(|duration| duration.as_secs_f64() * 1_000.0).collect::<Vec<_>>(),
                measurement.plan,
            );
        }
        for measurement in &measurements {
            assert_eq!(
                &measurement.rows, expected_rows,
                "{} must preserve collection counts",
                measurement.label
            );
        }
        for label in ["baseline", "id-covering"] {
            let label_measurements: Vec<&CollectionScopeBenchmarkMeasurement> = measurements
                .iter()
                .filter(|measurement| measurement.label == label)
                .collect();
            let first_reads: Vec<_> = label_measurements
                .iter()
                .map(|measurement| measurement.first_read)
                .collect();
            let warm_reads: Vec<_> = label_measurements
                .iter()
                .flat_map(|measurement| measurement.warm_reads.iter().copied())
                .collect();
            let write_costs: Vec<_> = label_measurements
                .iter()
                .flat_map(|measurement| measurement.write_costs.iter().copied())
                .collect();
            println!(
                "collection-index benchmark median {label}: first_ms={:.3} warm_ms={:.3} write_2k_ops_ms={:.3}",
                median_ms(&first_reads),
                median_ms(&warm_reads),
                median_ms(&write_costs),
            );
        }
        let candidate_plan = measurements
            .iter()
            .find(|measurement| measurement.label == "id-covering")
            .expect("id-covering benchmark measurement");
        assert!(
            candidate_plan.plan.iter().any(|detail| {
                detail.contains("idx_images_collection_scope_covering_v1")
                    && detail.contains("COVERING")
                    && detail.contains("id=?")
            }),
            "id-leading candidate must be a covering lookup: {:?}",
            candidate_plan.plan
        );
    }
}
