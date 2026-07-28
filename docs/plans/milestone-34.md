# Milestone 34: Published ComfyUI Catalog Refresh

Status: In progress
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Refresh the official workflow coverage snapshot from 549 to 578 entries and
intake the nine new open-source core Image workflows without making parser
claims before their exact pinned workflows are assessed.

Coverage is carried forward only when the upstream workflow Git blob is
unchanged. The 36 changed target workflows and nine new target workflows are
therefore `unassessed`; existing older fixtures remain historical parser
regressions until their current-release bytes are revalidated.

## Work Packages

1. Record every v0.11.15 workflow blob in manifest schema version 2, reapply
   the established target rules, and validate the refreshed counts offline.
2. Vendor the nine new workflow-only fixtures, verify their exact Git blob
   identities, and record graph/output diagnostics and source-authored metadata
   expectations without promoting coverage.

No parser behavior, parser version, frontend, database, command, binding,
diagnostics DTO, or metadata shape changes are in scope.

## Acceptance Gate

Run template-coverage, catalog-intake, official-catalog, workflow-subgraph,
output-selection, full ComfyUI, and metadata-reparse tests. Run
`cargo fmt --check` and `git diff --check`, and confirm parser version 36 and no
`Cargo.lock` churn.
