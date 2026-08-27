use tauri_plugin_sql::Migration;

/// Migration 68: add the compatibility-first media discriminator and the
/// technical fields needed by the manual video import/viewer slice.
pub fn migration68() -> Migration {
    Migration {
        version: 68,
        description: "add_video_library_assets",
        sql: r#"
            ALTER TABLE images ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image'
                CHECK (media_type IN ('image', 'video'));
            ALTER TABLE images ADD COLUMN media_container TEXT;
            ALTER TABLE images ADD COLUMN media_mime_type TEXT;
            ALTER TABLE images ADD COLUMN duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms > 0);
            ALTER TABLE images ADD COLUMN video_codec TEXT;
            ALTER TABLE images ADD COLUMN video_profile TEXT;
            ALTER TABLE images ADD COLUMN audio_present INTEGER CHECK (audio_present IS NULL OR audio_present IN (0, 1));
            ALTER TABLE images ADD COLUMN audio_codec TEXT;
            ALTER TABLE images ADD COLUMN frame_rate_num INTEGER CHECK (frame_rate_num IS NULL OR frame_rate_num > 0);
            ALTER TABLE images ADD COLUMN frame_rate_den INTEGER CHECK (frame_rate_den IS NULL OR frame_rate_den > 0);
            ALTER TABLE images ADD COLUMN rotation_degrees INTEGER CHECK (rotation_degrees IS NULL OR rotation_degrees IN (0, 90, 180, 270));
            ALTER TABLE images ADD COLUMN probe_status TEXT NOT NULL DEFAULT 'not_applicable'
                CHECK (probe_status IN ('not_applicable', 'ready', 'invalid'));
            ALTER TABLE images ADD COLUMN playback_status TEXT NOT NULL DEFAULT 'not_applicable'
                CHECK (playback_status IN ('not_applicable', 'unknown', 'playable', 'external_required'));

            ALTER TABLE removed_images ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image'
                CHECK (media_type IN ('image', 'video'));
            ALTER TABLE removed_images ADD COLUMN media_container TEXT;
            ALTER TABLE removed_images ADD COLUMN media_mime_type TEXT;
            ALTER TABLE removed_images ADD COLUMN duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms > 0);
            ALTER TABLE removed_images ADD COLUMN video_codec TEXT;
            ALTER TABLE removed_images ADD COLUMN video_profile TEXT;
            ALTER TABLE removed_images ADD COLUMN audio_present INTEGER CHECK (audio_present IS NULL OR audio_present IN (0, 1));
            ALTER TABLE removed_images ADD COLUMN audio_codec TEXT;
            ALTER TABLE removed_images ADD COLUMN frame_rate_num INTEGER CHECK (frame_rate_num IS NULL OR frame_rate_num > 0);
            ALTER TABLE removed_images ADD COLUMN frame_rate_den INTEGER CHECK (frame_rate_den IS NULL OR frame_rate_den > 0);
            ALTER TABLE removed_images ADD COLUMN rotation_degrees INTEGER CHECK (rotation_degrees IS NULL OR rotation_degrees IN (0, 90, 180, 270));
            ALTER TABLE removed_images ADD COLUMN probe_status TEXT NOT NULL DEFAULT 'not_applicable'
                CHECK (probe_status IN ('not_applicable', 'ready', 'invalid'));
            ALTER TABLE removed_images ADD COLUMN playback_status TEXT NOT NULL DEFAULT 'not_applicable'
                CHECK (playback_status IN ('not_applicable', 'unknown', 'playable', 'external_required'));

            CREATE INDEX idx_images_media_type_v1
                ON images(media_type, is_deleted, timestamp DESC, id DESC);
        "#,
        kind: tauri_plugin_sql::MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration68;

    #[test]
    fn migration_defaults_existing_active_and_removed_records_to_images() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                timestamp INTEGER NOT NULL
            ) STRICT;
            CREATE TABLE removed_images (
                id TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL
            ) STRICT;
            INSERT INTO images (id, timestamp) VALUES ('active', 10);
            INSERT INTO removed_images (id, timestamp) VALUES ('removed', 20);
            ",
        )
        .expect("setup schema");

        conn.execute_batch(migration68().sql)
            .expect("apply video migration");

        let active: (String, String, String) = conn
            .query_row(
                "SELECT media_type, probe_status, playback_status FROM images WHERE id = 'active'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("active row");
        let removed: (String, String, String) = conn
            .query_row(
                "SELECT media_type, probe_status, playback_status FROM removed_images WHERE id = 'removed'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("removed row");

        assert_eq!(
            active,
            (
                "image".into(),
                "not_applicable".into(),
                "not_applicable".into()
            )
        );
        assert_eq!(removed, active);
    }

    #[test]
    fn migration_accepts_valid_video_technical_state_and_rejects_invalid_enums() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                timestamp INTEGER NOT NULL
            ) STRICT;
            CREATE TABLE removed_images (
                id TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL
            ) STRICT;
            ",
        )
        .expect("setup schema");
        conn.execute_batch(migration68().sql)
            .expect("apply video migration");

        conn.execute(
            "INSERT INTO images (
                id, timestamp, media_type, duration_ms, audio_present,
                frame_rate_num, frame_rate_den, rotation_degrees,
                probe_status, playback_status
             ) VALUES ('video', 1, 'video', 2000, 1, 24, 1, 270, 'ready', 'unknown')",
            [],
        )
        .expect("valid video row");

        assert!(conn
            .execute(
                "INSERT INTO images (id, timestamp, media_type) VALUES ('bad-media', 1, 'audio')",
                [],
            )
            .is_err());
        assert!(conn
            .execute(
                "INSERT INTO images (id, timestamp, media_type, playback_status)
                 VALUES ('bad-playback', 1, 'video', 'maybe')",
                [],
            )
            .is_err());
    }
}
