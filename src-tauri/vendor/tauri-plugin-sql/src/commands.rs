// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use indexmap::IndexMap;
use serde_json::Value as JsonValue;
use sqlx::migrate::Migrator;
use tauri::{command, AppHandle, Runtime, State};

use crate::{DbInstances, DbPool, Error, LastInsertId, Migrations};

#[cfg(not(feature = "ambit-startup-trace"))]
#[command]
pub(crate) async fn load<R: Runtime>(
    app: AppHandle<R>,
    db_instances: State<'_, DbInstances>,
    migrations: State<'_, Migrations>,
    db: String,
) -> Result<String, crate::Error> {
    let pool = DbPool::connect(&db, &app).await?;

    if let Some(migrations) = migrations.0.lock().await.remove(&db) {
        let migrator = Migrator::new(migrations).await?;
        pool.migrate(&migrator).await?;
    }

    db_instances.0.write().await.insert(db.clone(), pool);

    Ok(db)
}

/// Allows the database connection(s) to be closed; if no database
/// name is passed in then _all_ database connection pools will be
/// shut down.
#[cfg(not(feature = "ambit-startup-trace"))]
#[command]
pub(crate) async fn close(
    db_instances: State<'_, DbInstances>,
    db: Option<String>,
) -> Result<bool, crate::Error> {
    let instances = db_instances.0.read().await;

    let pools = if let Some(db) = db {
        vec![db]
    } else {
        instances.keys().cloned().collect()
    };

    for pool in pools {
        let db = instances.get(&pool).ok_or(Error::DatabaseNotLoaded(pool))?;
        db.close().await;
    }

    Ok(true)
}

/// Execute a command against the database
#[cfg(not(feature = "ambit-startup-trace"))]
#[command]
pub(crate) async fn execute(
    db_instances: State<'_, DbInstances>,
    db: String,
    query: String,
    values: Vec<JsonValue>,
) -> Result<(u64, LastInsertId), crate::Error> {
    let instances = db_instances.0.read().await;

    let db = instances.get(&db).ok_or(Error::DatabaseNotLoaded(db))?;
    db.execute(query, values).await
}

#[cfg(not(feature = "ambit-startup-trace"))]
#[command]
pub(crate) async fn select(
    db_instances: State<'_, DbInstances>,
    db: String,
    query: String,
    values: Vec<JsonValue>,
) -> Result<Vec<IndexMap<String, JsonValue>>, crate::Error> {
    let instances = db_instances.0.read().await;

    let db = instances.get(&db).ok_or(Error::DatabaseNotLoaded(db))?;
    db.select(query, values).await
}

#[cfg(feature = "ambit-startup-trace")]
use crate::startup_trace::{Operation, Stage, Status, TraceState};

#[cfg(feature = "ambit-startup-trace")]
#[command]
pub(crate) async fn load<R: Runtime>(
    app: AppHandle<R>,
    db_instances: State<'_, DbInstances>,
    migrations: State<'_, Migrations>,
    trace_state: State<'_, TraceState>,
    db: String,
) -> Result<String, crate::Error> {
    let mut trace = trace_state
        .0
        .as_ref()
        .and_then(|collector| collector.begin(Operation::Load, Some(&db), None));
    let result = async {
        let pool = DbPool::connect(&db, &app).await?;
        if let Some(trace) = trace.as_mut() {
            trace.stage(Stage::MigrationMutex);
        }
        // Keep the upstream if-let temporary guard lifetime across migration work.
        if let Some(migrations) = migrations.0.lock().await.remove(&db) {
            if let Some(trace) = trace.as_mut() {
                trace.stage(Stage::Migrate);
            }
            let migrator = Migrator::new(migrations).await?;
            pool.migrate(&migrator).await?;
        }
        if let Some(trace) = trace.as_mut() {
            trace.stage(Stage::RegistryWrite);
        }
        let mut instances = db_instances.0.write().await;
        if let Some(trace) = trace.as_mut() {
            trace.stage(Stage::Work);
        }
        instances.insert(db.clone(), pool);
        drop(instances);
        Ok(db)
    }
    .await;
    if let Some(trace) = trace.as_mut() {
        trace.finish(if result.is_ok() {
            Status::Completed
        } else {
            Status::Failed
        });
    }
    result
}

#[cfg(feature = "ambit-startup-trace")]
#[command]
pub(crate) async fn close(
    db_instances: State<'_, DbInstances>,
    trace_state: State<'_, TraceState>,
    db: Option<String>,
) -> Result<bool, crate::Error> {
    let mut trace = trace_state
        .0
        .as_ref()
        .and_then(|collector| collector.begin(Operation::Close, db.as_deref(), None));
    let result = async {
        let instances = db_instances.0.read().await;
        if let Some(trace) = trace.as_mut() {
            trace.stage(Stage::Work);
        }
        let pools = if let Some(db) = db {
            vec![db]
        } else {
            instances.keys().cloned().collect()
        };
        for pool in pools {
            let db = instances.get(&pool).ok_or(Error::DatabaseNotLoaded(pool))?;
            db.close().await;
        }
        Ok(true)
    }
    .await;
    if let Some(trace) = trace.as_mut() {
        trace.finish(if result.is_ok() {
            Status::Completed
        } else {
            Status::Failed
        });
    }
    result
}

#[cfg(feature = "ambit-startup-trace")]
#[command]
pub(crate) async fn execute(
    db_instances: State<'_, DbInstances>,
    trace_state: State<'_, TraceState>,
    db: String,
    query: String,
    values: Vec<JsonValue>,
) -> Result<(u64, LastInsertId), crate::Error> {
    let mut trace = trace_state
        .0
        .as_ref()
        .and_then(|collector| collector.begin(Operation::Execute, Some(&db), None));
    let result = async {
        let instances = db_instances.0.read().await;
        if let Some(trace) = trace.as_mut() {
            trace.stage(Stage::Work);
        }
        let db = instances.get(&db).ok_or(Error::DatabaseNotLoaded(db))?;
        db.execute(query, values).await
    }
    .await;
    if let Some(trace) = trace.as_mut() {
        trace.finish(if result.is_ok() {
            Status::Completed
        } else {
            Status::Failed
        });
    }
    result
}

#[cfg(feature = "ambit-startup-trace")]
#[command]
pub(crate) async fn select(
    db_instances: State<'_, DbInstances>,
    trace_state: State<'_, TraceState>,
    db: String,
    query: String,
    values: Vec<JsonValue>,
    startup_trace: Option<JsonValue>,
) -> Result<Vec<IndexMap<String, JsonValue>>, crate::Error> {
    let mut trace = trace_state
        .0
        .as_ref()
        .and_then(|collector| collector.begin(Operation::Select, Some(&db), startup_trace));
    let result = async {
        let instances = db_instances.0.read().await;
        if let Some(trace) = trace.as_mut() {
            trace.stage(Stage::Work);
        }
        let db = instances.get(&db).ok_or(Error::DatabaseNotLoaded(db))?;
        // The registry guard remains borrowed throughout fetch and result decoding.
        if let Some(trace) = trace.as_mut().filter(|trace| trace.detailed()) {
            db.select_traced(query, values, trace).await
        } else {
            db.select(query, values).await
        }
    }
    .await;
    if let Some(trace) = trace.as_mut() {
        trace.finish(if result.is_ok() {
            Status::Completed
        } else {
            Status::Failed
        });
    }
    result
}
