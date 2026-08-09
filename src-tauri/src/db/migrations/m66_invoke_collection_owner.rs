use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 66: Persist the owner of InvokeAI board-backed collections.
pub fn migration66() -> Migration {
    Migration {
        version: 66,
        description: "add_invoke_collection_owner",
        sql: r#"
            ALTER TABLE collections ADD COLUMN invoke_owner_id TEXT;

            CREATE INDEX idx_collections_invoke_owner_scope
                ON collections(source, invoke_owner_id);
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration66;
    use rusqlite::Connection;

    #[test]
    fn owner_scoped_collection_query_hides_other_and_unassigned_invoke_boards() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE collections (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL DEFAULT 'ambit'
            );
            CREATE TABLE invoke_owner_scope_state (
                state_key TEXT PRIMARY KEY,
                scope_mode TEXT NOT NULL,
                owner_id TEXT
            );
            INSERT INTO collections (id, source) VALUES
                ('ambit', 'ambit'),
                ('owned-a', 'invoke'),
                ('owned-b', 'invoke'),
                ('unassigned', 'invoke');
            ",
        )
        .expect("source schema");
        conn.execute_batch(migration66().sql)
            .expect("apply migration");
        conn.execute(
            "UPDATE collections SET invoke_owner_id = ? WHERE id = ?",
            ["owner-a", "owned-a"],
        )
        .expect("owner a");
        conn.execute(
            "UPDATE collections SET invoke_owner_id = ? WHERE id = ?",
            ["owner-b", "owned-b"],
        )
        .expect("owner b");
        conn.execute(
            "INSERT INTO invoke_owner_scope_state (state_key, scope_mode, owner_id)
             VALUES ('current', 'owner', 'owner-a')",
            [],
        )
        .expect("scope state");

        let ids: Vec<String> = conn
            .prepare(
                "SELECT c.id
                 FROM collections c
                 WHERE COALESCE(c.source, 'ambit') != 'invoke'
                    OR EXISTS (
                        SELECT 1 FROM invoke_owner_scope_state s
                        WHERE s.state_key = 'current'
                          AND (
                            s.scope_mode IN ('legacy', 'all')
                            OR (s.scope_mode = 'owner' AND c.invoke_owner_id = s.owner_id)
                          )
                    )
                 ORDER BY c.id",
            )
            .expect("prepare visibility query")
            .query_map([], |row| row.get(0))
            .expect("query visibility")
            .collect::<Result<_, _>>()
            .expect("collect visibility");

        assert_eq!(ids, vec!["ambit".to_string(), "owned-a".to_string()]);

        let plan: Vec<String> = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT id FROM collections
                 WHERE source = 'invoke' AND invoke_owner_id = 'owner-a'",
            )
            .expect("prepare query plan")
            .query_map([], |row| row.get(3))
            .expect("query plan")
            .collect::<Result<_, _>>()
            .expect("collect plan");
        assert!(
            plan.iter()
                .any(|detail| detail.contains("idx_collections_invoke_owner_scope")),
            "expected collection owner index, got {plan:?}"
        );
    }
}
