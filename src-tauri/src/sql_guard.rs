//! Restricts `tauri-plugin-sql` to Ambit's own library database.
//!
//! The plugin's `load` command opens any `sqlite:` URL it is given, and an
//! absolute path replaces its app-config base. Its permissions cannot scope the
//! URL, so this wrapper refuses every `load` whose `db` is not the URL that
//! `get_main_database_url` hands the frontend. `select`, `execute` and `close`
//! act only on databases already loaded, but SQL run there can still reach other
//! files through `ATTACH` and `VACUUM INTO`, so guarding `load` alone is not a
//! boundary (#387 stays open until those commands are guarded too).

use serde_json::Value as JsonValue;
use tauri::{
    ipc::{Invoke, InvokeBody},
    plugin::Plugin,
    webview::PageLoadPayload,
    AppHandle, Manager, RunEvent, Runtime, Url, Webview, Window,
};

const LOAD_REFUSED: &str = "The SQL plugin may open only Ambit's library database.";
const LOAD_UNRESOLVED: &str = "Ambit's library database location could not be resolved.";

type AllowedUrl<R> = Box<dyn Fn(&AppHandle<R>) -> Result<String, String> + Send + Sync>;

/// Wraps the built SQL plugin and lets `load` through only for the library URL.
///
/// Every `Plugin` method except `extend_api` forwards to the inner plugin:
/// `name`, `initialize`, `initialization_script`, `window_created`,
/// `webview_created`, `on_navigation`, `on_page_load` and `on_event`.
/// `initialization_script_2` keeps its default, which wraps the forwarded
/// `initialization_script` (its return type is not re-exported by `tauri`, and
/// the SQL plugin sets no initialization script).
///
/// A method that a future Tauri release adds with a default implementation is
/// not forwarded until it is added here, so recheck the `Plugin` trait on each
/// Tauri minor bump.
pub struct SqlLoadGuard<R: Runtime> {
    inner: Box<dyn Plugin<R>>,
    allowed_url: AllowedUrl<R>,
}

impl<R: Runtime> SqlLoadGuard<R> {
    pub fn new<P, F>(inner: P, allowed_url: F) -> Self
    where
        P: Plugin<R> + 'static,
        F: Fn(&AppHandle<R>) -> Result<String, String> + Send + Sync + 'static,
    {
        Self {
            inner: Box::new(inner),
            allowed_url: Box::new(allowed_url),
        }
    }
}

/// Whether a `load` request names exactly the allowed connection URL.
/// Anything other than a JSON body with a string `db` equal to `allowed` is refused.
fn sql_load_allowed(payload: &InvokeBody, allowed: &str) -> bool {
    match payload {
        InvokeBody::Json(body) => body.get("db").and_then(JsonValue::as_str) == Some(allowed),
        InvokeBody::Raw(_) => false,
    }
}

impl<R: Runtime> Plugin<R> for SqlLoadGuard<R> {
    fn name(&self) -> &'static str {
        self.inner.name()
    }

    fn initialize(
        &mut self,
        app: &AppHandle<R>,
        config: JsonValue,
    ) -> Result<(), Box<dyn std::error::Error>> {
        self.inner.initialize(app, config)
    }

    fn initialization_script(&self) -> Option<String> {
        self.inner.initialization_script()
    }

    fn window_created(&mut self, window: Window<R>) {
        self.inner.window_created(window)
    }

    fn webview_created(&mut self, webview: Webview<R>) {
        self.inner.webview_created(webview)
    }

    fn on_navigation(&mut self, webview: &Webview<R>, url: &Url) -> bool {
        self.inner.on_navigation(webview, url)
    }

    fn on_page_load(&mut self, webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
        self.inner.on_page_load(webview, payload)
    }

    fn on_event(&mut self, app: &AppHandle<R>, event: &RunEvent) {
        self.inner.on_event(app, event)
    }

    fn extend_api(&mut self, invoke: Invoke<R>) -> bool {
        if invoke.message.command() == "load" {
            let app = invoke.message.webview().app_handle().clone();
            match (self.allowed_url)(&app) {
                Ok(allowed) if sql_load_allowed(invoke.message.payload(), &allowed) => {}
                Ok(_) => {
                    invoke.resolver.reject(LOAD_REFUSED);
                    return true;
                }
                Err(error) => {
                    log::error!("[SQL] Failed to resolve the library database URL: {error}");
                    invoke.resolver.reject(LOAD_UNRESOLVED);
                    return true;
                }
            }
        }
        self.inner.extend_api(invoke)
    }
}

#[cfg(test)]
mod tests {
    use super::sql_load_allowed;
    use serde_json::json;
    use tauri::ipc::InvokeBody;

    const ALLOWED: &str = "sqlite:C:/Users/me/AppData/Local/com.ambit/images.db";

    #[test]
    fn exact_library_url_is_allowed() {
        assert!(sql_load_allowed(
            &InvokeBody::Json(json!({ "db": ALLOWED })),
            ALLOWED
        ));
        assert!(sql_load_allowed(
            &InvokeBody::Json(json!({ "db": ALLOWED, "options": { "autoCreate": false } })),
            ALLOWED
        ));
    }

    #[test]
    fn other_or_malformed_requests_are_refused() {
        let refused = [
            InvokeBody::Json(json!({})),
            InvokeBody::Json(json!({ "db": null })),
            InvokeBody::Json(json!({ "db": 7 })),
            InvokeBody::Json(json!({ "db": [ALLOWED] })),
            InvokeBody::Json(json!(ALLOWED)),
            InvokeBody::Json(json!({ "db": "sqlite:C:/InvokeAI/databases/invokeai.db" })),
            // Spelling variants of the same file are refused too: the plugin keys
            // its pools by the exact string, so only the frontend's URL is needed.
            InvokeBody::Json(json!({ "db": ALLOWED.to_uppercase() })),
            InvokeBody::Json(json!({ "db": ALLOWED.replace('/', "\\") })),
            InvokeBody::Json(json!({ "db": format!("{ALLOWED}?mode=rwc") })),
            InvokeBody::Raw(ALLOWED.as_bytes().to_vec()),
        ];
        for body in refused {
            assert!(
                !sql_load_allowed(&body, ALLOWED),
                "{body:?} must be refused"
            );
        }
    }
}
