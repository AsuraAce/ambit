//! Logs how long a background job keeps a write transaction open (#464).
//!
//! While one connection holds SQLite's write lock, every other writer waits for
//! its busy timeout and then fails. Frontend writes use a 5 s timeout, so a
//! background transaction that stays open longer makes the user's masks,
//! favorites and collection counts fail. Each long-running write path starts a
//! [`WriteHold`] when it opens its transaction. A hold over [`REPORT_THRESHOLD`]
//! is logged at INFO with its call site, so an owner log names the holder.

use std::time::{Duration, Instant};

/// Holds at or above this are logged at INFO; shorter ones at DEBUG.
pub const REPORT_THRESHOLD: Duration = Duration::from_secs(1);

pub struct WriteHold {
    site: &'static str,
    started: Instant,
    started_at: chrono::DateTime<chrono::Utc>,
}

impl WriteHold {
    /// Start timing right after the transaction opens.
    pub fn begin(site: &'static str) -> Self {
        Self {
            site,
            started: Instant::now(),
            started_at: chrono::Utc::now(),
        }
    }
}

pub(crate) fn report_level(held: Duration) -> log::Level {
    if held >= REPORT_THRESHOLD {
        log::Level::Info
    } else {
        log::Level::Debug
    }
}

impl Drop for WriteHold {
    fn drop(&mut self) {
        let held = self.started.elapsed();
        log::log!(
            report_level(held),
            "[DB] write transaction held site={} hold_ms={} start={} end={}",
            self.site,
            held.as_millis(),
            self.started_at
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_long_enough_to_fail_user_writes_are_reported_at_info() {
        // A frontend write gives up after 5 s; a hold of a second is already worth naming.
        assert_eq!(report_level(Duration::from_millis(999)), log::Level::Debug);
        assert_eq!(report_level(Duration::from_secs(1)), log::Level::Info);
        assert_eq!(report_level(Duration::from_secs(35)), log::Level::Info);
    }
}
