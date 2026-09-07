// All current image-scope views share this eligibility rule. Source/projection
// arguments are compile-time SQL literals, never user input.
macro_rules! image_scope_view_sql {
    ($name:literal, $projection:literal, $source:literal) => {
        concat!(
            "CREATE VIEW ",
            $name,
            " AS SELECT ",
            $projection,
            " FROM ",
            $source,
            r#"
            LEFT JOIN invoke_owner_scope_state s ON s.state_key = 'current'
            WHERE (i.invoke_source_id IS NULL AND i.invoke_scope_hidden = 0)
               OR (
                    i.invoke_source_id = s.db_path
                    AND (
                        s.scope_mode IN ('legacy', 'all')
                        OR (s.scope_mode = 'owner' AND i.invoke_owner_id = s.owner_id)
                    )
               )"#,
            ";"
        )
    };
}

pub(crate) use image_scope_view_sql;
