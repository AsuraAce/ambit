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

    migrations.sort_by_key(|m| m.version);

    migrations
}

#[cfg(test)]
mod tests {
    use super::get_migrations;

    #[test]
    fn migrations_include_mainline_49_and_privacy_50() {
        let versions: Vec<i64> = get_migrations()
            .iter()
            .map(|migration| migration.version)
            .collect();

        assert!(versions.contains(&49));
        assert!(versions.contains(&50));
    }

    #[test]
    fn migrations_are_sorted_by_version() {
        let versions: Vec<i64> = get_migrations()
            .iter()
            .map(|migration| migration.version)
            .collect();
        let mut sorted = versions.clone();
        sorted.sort_unstable();

        assert_eq!(versions, sorted);
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
    fn database_at_mainline_49_has_privacy_50_pending() {
        let migrations = get_migrations();
        let has_49 = migrations.iter().any(|migration| migration.version == 49);
        let pending_after_49: Vec<i64> = migrations
            .iter()
            .filter(|migration| migration.version > 49)
            .map(|migration| migration.version)
            .collect();

        assert!(has_49);
        assert_eq!(pending_after_49, vec![50]);
    }
}
