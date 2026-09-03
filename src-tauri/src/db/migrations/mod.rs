use tauri_plugin_sql::Migration;

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

    migrations.sort_by_key(|m| m.version);

    migrations
}

#[cfg(test)]
mod tests {
    use super::get_migrations;
    use rusqlite::Connection;

    #[test]
    fn migrations_include_mainline_through_thumbnail_candidate_indexes_79() {
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
    fn database_at_mainline_49_has_migrations_through_thumbnail_repair_candidates_79_pending() {
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
                71, 72, 73, 74, 75, 76, 77, 78, 79
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
}
