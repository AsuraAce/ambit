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
    
    // Ensure migrations are sorted by version (tauri-plugin-sql needs this?)
    // Actually, pushing in order is usually enough, but let's be safe if needed.
    // migrations.sort_by_key(|m| m.version);
    
    migrations
}


