//! Windows-only, value-redacted WebView2 process-failure observations.
//!
//! The COM registration is thread-local to Tauri's event-loop thread. Only its
//! thread identity is mirrored in shared state, so no COM handle crosses into a
//! worker or managed application state.

use crate::startup_log::StartupJournal;
use std::{
    cell::RefCell,
    sync::{Arc, Mutex},
    thread::ThreadId,
};
use tauri::{WebviewWindow, Wry};
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2ProcessFailedEventArgs2, COREWEBVIEW2_PROCESS_FAILED_KIND,
    },
    ProcessFailedEventHandler,
};
use windows_core::Interface;

const REGISTERED: &str = "registered";
const REGISTRATION_UNAVAILABLE: &str = "registration-unavailable";
const FAILURE_KIND_UNAVAILABLE: &str = "failure-kind-unavailable";
const HANDLER_REMOVED: &str = "handler-removed";
const HANDLER_REMOVAL_UNAVAILABLE: &str = "handler-removal-unavailable";

struct Registration {
    webview: ICoreWebView2,
    token: i64,
}

thread_local! {
    static REGISTRATION: RefCell<Option<Registration>> = const { RefCell::new(None) };
}

/// Shared, COM-free state. `teardown_on_current_thread` verifies the caller is
/// the Tauri UI thread before touching the thread-local registration.
pub struct ProcessFailedObserver {
    journal: Arc<StartupJournal>,
    state: Arc<Mutex<ObserverState>>,
}

#[derive(Default)]
struct ObserverState {
    registration_started: bool,
    registration_thread: Option<ThreadId>,
    teardown_started: bool,
}

#[derive(Debug, Eq, PartialEq)]
enum TeardownDecision {
    AlreadyRemoved,
    NotRegistered,
    PendingRegistration,
    OwnerThread,
    WrongThread,
}

impl ObserverState {
    fn begin_registration(&mut self) -> bool {
        if self.registration_started || self.teardown_started {
            return false;
        }
        self.registration_started = true;
        true
    }

    fn finish_registration(&mut self, thread: ThreadId) -> bool {
        if self.teardown_started || self.registration_thread.is_some() {
            return false;
        }
        self.registration_thread = Some(thread);
        true
    }

    fn begin_teardown(&mut self, thread: ThreadId) -> TeardownDecision {
        if self.teardown_started {
            return TeardownDecision::AlreadyRemoved;
        }
        match self.registration_thread {
            Some(owner) if owner == thread => {
                self.teardown_started = true;
                TeardownDecision::OwnerThread
            }
            Some(_) => TeardownDecision::WrongThread,
            None if self.registration_started => {
                self.teardown_started = true;
                TeardownDecision::PendingRegistration
            }
            None => TeardownDecision::NotRegistered,
        }
    }
}

impl ProcessFailedObserver {
    pub fn new(journal: Arc<StartupJournal>) -> Self {
        Self {
            journal,
            state: Arc::new(Mutex::new(ObserverState::default())),
        }
    }

    /// Registers exactly once on Tauri's UI thread. Failure is evidence-only:
    /// it changes neither loading, restart, graphics, nor application state.
    pub fn register(&self, window: &WebviewWindow<Wry>) {
        let Ok(mut state) = self.state.lock() else {
            self.journal.webview_observation(REGISTRATION_UNAVAILABLE);
            return;
        };
        if !state.begin_registration() {
            return;
        }
        drop(state);

        let journal = self.journal.clone();
        let state = self.state.clone();
        if window
            .with_webview(move |webview| {
                let can_register = state
                    .lock()
                    .map(|state| !state.teardown_started)
                    .unwrap_or(false);
                if !can_register {
                    journal.webview_observation(REGISTRATION_UNAVAILABLE);
                    return;
                }

                let handler_journal = journal.clone();
                let handler = ProcessFailedEventHandler::create(Box::new(move |_sender, args| {
                    let classification = args
                        .as_ref()
                        .and_then(|args| {
                            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                            unsafe { args.ProcessFailedKind(&mut kind) }
                                .ok()
                                .map(|()| classify_process_failed_kind(kind))
                        })
                        .unwrap_or(FAILURE_KIND_UNAVAILABLE);
                    // Only a numeric code crosses the callback boundary. Never request
                    // process descriptions, frame details, module paths or crash dumps.
                    let exit_code = args.and_then(|args| {
                        let details = args.cast::<ICoreWebView2ProcessFailedEventArgs2>().ok()?;
                        let mut code = 0i32;
                        unsafe { details.ExitCode(&mut code) }.ok().map(|()| code)
                    });
                    handler_journal.webview_failure(classification, exit_code);
                    Ok(())
                }));

                let Ok(core) = (unsafe { webview.controller().CoreWebView2() }) else {
                    journal.webview_observation(REGISTRATION_UNAVAILABLE);
                    return;
                };
                let mut token = 0i64;
                if unsafe { core.add_ProcessFailed(&handler, &mut token) }.is_err() {
                    journal.webview_observation(REGISTRATION_UNAVAILABLE);
                    return;
                }

                let registration_stored = REGISTRATION.with(|registration| {
                    if registration.borrow().is_some() {
                        return false;
                    }
                    *registration.borrow_mut() = Some(Registration {
                        webview: core.clone(),
                        token,
                    });
                    true
                });
                if !registration_stored {
                    let _ = unsafe { core.remove_ProcessFailed(token) };
                    journal.webview_observation(REGISTRATION_UNAVAILABLE);
                    return;
                }

                let on_registration_thread = state
                    .lock()
                    .map(|mut state| state.finish_registration(std::thread::current().id()))
                    .unwrap_or(false);
                if on_registration_thread {
                    journal.webview_observation(REGISTERED);
                } else {
                    REGISTRATION.with(|registration| {
                        if let Some(registration) = registration.borrow_mut().take() {
                            let _ = unsafe {
                                registration
                                    .webview
                                    .remove_ProcessFailed(registration.token)
                            };
                        }
                    });
                    journal.webview_observation(REGISTRATION_UNAVAILABLE);
                }
            })
            .is_err()
        {
            self.journal.webview_observation(REGISTRATION_UNAVAILABLE);
        }
    }

    /// Removes the token directly, rather than queueing work, when Tauri calls
    /// its run callback on the same UI thread that installed the registration.
    /// It is safe to call for both main-window destruction and process exit.
    pub fn teardown_on_current_thread(&self) {
        let decision = self
            .state
            .lock()
            .map(|mut state| state.begin_teardown(std::thread::current().id()));
        let Ok(decision) = decision else {
            self.journal
                .webview_observation(HANDLER_REMOVAL_UNAVAILABLE);
            return;
        };
        match decision {
            TeardownDecision::OwnerThread => {}
            TeardownDecision::WrongThread => {
                self.journal
                    .webview_observation(HANDLER_REMOVAL_UNAVAILABLE);
                return;
            }
            TeardownDecision::AlreadyRemoved
            | TeardownDecision::NotRegistered
            | TeardownDecision::PendingRegistration => return,
        }

        let removed = REGISTRATION.with(|registration| {
            registration
                .borrow_mut()
                .take()
                .is_some_and(|registration| unsafe {
                    registration
                        .webview
                        .remove_ProcessFailed(registration.token)
                        .is_ok()
                })
        });
        self.journal.webview_observation(if removed {
            HANDLER_REMOVED
        } else {
            HANDLER_REMOVAL_UNAVAILABLE
        });
    }

    pub fn registration_unavailable(&self) {
        self.journal.webview_observation(REGISTRATION_UNAVAILABLE);
    }
}

fn classify_process_failed_kind(kind: COREWEBVIEW2_PROCESS_FAILED_KIND) -> &'static str {
    match kind.0 {
        0 => "browser-process-exited",
        1 => "render-process-exited",
        2 => "render-process-unresponsive",
        3 => "frame-render-process-exited",
        4 => "utility-process-exited",
        5 => "sandbox-helper-process-exited",
        6 => "gpu-process-exited",
        7 => "ppapi-plugin-process-exited",
        8 => "ppapi-broker-process-exited",
        9 => "unknown-process-exited",
        _ => FAILURE_KIND_UNAVAILABLE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_failure_kinds_are_fixed_and_value_redacted() {
        let expected = [
            "browser-process-exited",
            "render-process-exited",
            "render-process-unresponsive",
            "frame-render-process-exited",
            "utility-process-exited",
            "sandbox-helper-process-exited",
            "gpu-process-exited",
            "ppapi-plugin-process-exited",
            "ppapi-broker-process-exited",
            "unknown-process-exited",
        ];
        for (value, classification) in expected.into_iter().enumerate() {
            assert_eq!(
                classify_process_failed_kind(COREWEBVIEW2_PROCESS_FAILED_KIND(value as i32)),
                classification
            );
        }
        assert_eq!(
            classify_process_failed_kind(COREWEBVIEW2_PROCESS_FAILED_KIND(-1)),
            FAILURE_KIND_UNAVAILABLE
        );
    }

    #[test]
    fn registration_and_teardown_are_one_shot_on_the_owner_thread() {
        let mut state = ObserverState::default();
        let owner = std::thread::current().id();
        assert!(state.begin_registration());
        assert!(!state.begin_registration());
        assert!(state.finish_registration(owner));
        assert_eq!(state.begin_teardown(owner), TeardownDecision::OwnerThread);
        assert_eq!(
            state.begin_teardown(owner),
            TeardownDecision::AlreadyRemoved
        );
    }

    #[test]
    fn early_teardown_blocks_a_late_registration() {
        let mut state = ObserverState::default();
        assert!(state.begin_registration());
        assert_eq!(
            state.begin_teardown(std::thread::current().id()),
            TeardownDecision::PendingRegistration
        );
        assert!(!state.finish_registration(std::thread::current().id()));
    }

    #[test]
    fn wrong_thread_teardown_is_reportable_and_leaves_owner_retriable() {
        let mut state = ObserverState::default();
        let owner = std::thread::current().id();
        let other = std::thread::spawn(|| std::thread::current().id())
            .join()
            .expect("thread id");
        assert_ne!(owner, other);
        assert!(state.begin_registration());
        assert!(state.finish_registration(owner));
        assert_eq!(state.begin_teardown(other), TeardownDecision::WrongThread);
        assert_eq!(state.begin_teardown(owner), TeardownDecision::OwnerThread);
    }
}
