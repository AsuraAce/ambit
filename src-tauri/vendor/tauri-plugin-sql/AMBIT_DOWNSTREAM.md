# Ambit diagnostic-only SQL trace patch

Vendored from the exact installed crates.io `tauri-plugin-sql` **2.4.0** package.
Crate SHA-256: `cbbdb4f17a7984ef0aa425b11e543a44d11f2fddbdee3fc61970091f8adfb914`.
Upstream VCS revision: `d6a3898001a4bcc659e045f9501498751b77dbe6`, `plugins/sql`.
The original package assets, permissions, guest JavaScript, build assets, licenses,
`Cargo.toml.orig` and VCS provenance remain included. No upstream publication.

## Downstream difference

The nondefault `ambit-startup-trace` feature exposes a Rust collector/builder hook
and an optional `startupTrace` JSON argument on `select`. Invalid metadata disables
detail tracing, never the SQL command. Default command and pool bodies retain
the upstream implementation. Ambit's nondefault `startup-sql-trace` feature maps
to this feature; Ambit separately rejects diagnostic release builds.

The collector admits at most 32 detailed and 128 coarse records per launch.
One monotonic atomic word reserves fixed slots and linearizes stop-admission;
strong compare/exchange retries have a finite bound set by the slot capacities.
Each span owns its mutable timing record and uniquely publishes immutable
completion through its slot. Query callbacks never acquire the observer's
delivery-state mutex, wait for storage, spin on a lock, or perform I/O. Observer
contention no longer drops admission or publication. Dropped counters retain
invalid/duplicate metadata and capacity exhaustion, not intermediate stage loss.
Detailed call IDs are restricted to the existing 1–32 transport contract.

Pending snapshots retain a latest fixed stage and elapsed observation duration;
component timings remain null until terminal completion. An unfinished record
sealed at final observation also has unknown component timings. A reservation
paused before immutable initialization remains counted as admitted and pending,
even at teardown, rather than fabricating a record or reporting zero work.
Atomic sealing prevents a late publisher from rewriting incomplete evidence.
No SQL, parameters, URLs, returned values or raw errors appear in snapshots;
main URLs and launch IDs exist only in memory for classification/validation.
Draining never recycles slots. Stop-admission permits admitted work to finish;
final observation/180 seconds ignores late completion without cancelling work.

Selected SQLite calls split existing binding, physical acquisition, fetch and
result decoding. Fetch includes SQLite execution and SQLx row materialization,
not pure SQLite CPU time. The checked-out connection is returned before JSON
decoding, as with upstream `Pool::fetch_all`. The registry read guard is retained
through decoding. Load's migration mutex temporary lifetime and registry-write
ordering are preserved; no connection settings, indexes, pool sizes, acquisition
timeouts, migrations, retries or close/replacement behavior are changed.

Remove this patch after the diagnostic investigation, or replace it only after
equivalent generated IPC correctness/lifecycle/privacy tests and overhead gates
pass. Trace timings are diagnostic evidence, not a startup-speed acceptance claim.

Removal procedure: first return to the ordinary `app:dev` command (no feature).
In a separately reviewed cleanup, remove the root local `[patch.crates-io]`
entry and diagnostic feature wiring, plugin-specific collector adapters/tests,
and this vendor directory; keep the independent startup journal and prior fixes.
Resolve the same pinned crates.io 2.4.0 package without unrelated upgrades, verify
its registry checksum above, and rerun default IPC, bindings and desktop gates.
Removing only the vendor directory while its Cargo patch remains is not valid.
