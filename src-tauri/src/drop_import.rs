//! Files and folders dropped onto the window (#493).
//!
//! `dragDropEnabled` stays off. Tauri's native drop replaces WebView2's own drop
//! target, which stops the HTML5 drag-and-drop Ambit uses inside the window
//! (cards to collections, the pinned shelf, compare). Instead the webview posts
//! the dropped `File` objects with `chrome.webview.postMessageWithAdditionalObjects`.
//! WebView2 turns each into an `ICoreWebView2File` whose path its browser process
//! supplies; page script cannot give a `File` an OS path, and WebView2 refuses to
//! post a `File` with no file on disk. Rust reads paths only from those objects,
//! never from the message, and only from Ambit's own origin.
//!
//! The message is a JSON string. wry's own message handler, registered first,
//! fails on any other kind of message, and WebView2 then skips the handlers after
//! it. Tauri's IPC also sees the string; it is not a command, so Tauri only writes
//! a parse error to the page console.
//!
//! Dropped image and video files are granted and recorded as the file picker
//! does. A dropped folder goes through the folder confirmation and is recorded as
//! a library folder. The webview learns the outcome from [`LibraryDropResult`].
//! Only WebView2 offers this, so other platforms have no drop import.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::scanner::traversal::classify_media_path;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::{Runtime, Url};

/// The `type` of the message the webview posts with the dropped files.
const DROP_MESSAGE_TYPE: &str = "ambit-drop";
const MAX_DROP_ID_LEN: usize = 64;

/// What a drop did, sent to the webview once Rust has granted what it could.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDropResult {
    /// The id the webview sent with the drop.
    pub drop_id: String,
    /// Image and video files, granted and recorded, as WebView2 spells them.
    pub files: Vec<String>,
    /// Folders the user allowed, or that a grant already covered.
    pub folders: Vec<String>,
    /// Folders the user did not allow.
    pub declined_folders: Vec<String>,
    /// Files of a type Ambit does not import.
    pub unsupported: Vec<String>,
    /// Files and folders Ambit could not read or grant.
    pub unreadable: Vec<String>,
    /// Positions, in the dropped list, of items with no file on disk, such as a
    /// file dragged from a browser.
    pub without_path: Vec<u32>,
}

#[derive(Deserialize)]
struct DropMessage {
    #[serde(rename = "type")]
    kind: String,
    id: String,
}

/// The origin Ambit's own pages load from: the dev server in a dev build,
/// otherwise Tauri's `tauri.localhost`.
pub(crate) fn app_origin(dev_url: Option<&Url>, is_dev: bool, use_https_scheme: bool) -> String {
    match dev_url {
        Some(url) if is_dev => url.origin().ascii_serialization(),
        _ => format!(
            "{}://tauri.localhost",
            if use_https_scheme { "https" } else { "http" }
        ),
    }
}

/// The drop id of a drop message from Ambit's own page, or `None` for anything
/// else: another origin, a Tauri command, another message type, a bad id.
/// Nothing else in the message is read; paths come only from the native objects.
fn drop_id_from_message(source: &str, app_origin: &str, message_json: &str) -> Option<String> {
    let source = Url::parse(source).ok()?;
    if source.origin().ascii_serialization() != app_origin {
        return None;
    }
    let message: DropMessage = serde_json::from_str(message_json).ok()?;
    let id_is_valid = !message.id.is_empty()
        && message.id.len() <= MAX_DROP_ID_LEN
        && message
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    (message.kind == DROP_MESSAGE_TYPE && id_is_valid).then_some(message.id)
}

/// The dropped paths sorted by what Ambit does with them.
#[derive(Debug, Default, PartialEq, Eq)]
struct SortedDrop {
    files: Vec<String>,
    folders: Vec<String>,
    unsupported: Vec<String>,
    unreadable: Vec<String>,
    without_path: Vec<u32>,
}

/// Sorts the paths WebView2 gave for the dropped objects, in their order. An
/// object without a path (a virtual or browser file) has `None` or an empty path.
fn sort_dropped(paths: &[Option<String>]) -> SortedDrop {
    let mut sorted = SortedDrop::default();
    for (index, path) in paths.iter().enumerate() {
        let Some(path) = path.as_deref().filter(|path| !path.trim().is_empty()) else {
            sorted.without_path.push(index as u32);
            continue;
        };
        match fs::metadata(path) {
            Ok(metadata) if metadata.is_dir() => sorted.folders.push(path.to_string()),
            Ok(metadata) if metadata.is_file() => {
                if classify_media_path(Path::new(path)).is_some() {
                    sorted.files.push(path.to_string());
                } else {
                    sorted.unsupported.push(path.to_string());
                }
            }
            _ => sorted.unreadable.push(path.to_string()),
        }
    }
    sorted
}

/// Grants and records the dropped image and video files, as the file picker
/// does, and moves any file that cannot be granted to `unreadable`.
async fn grant_dropped_files<R: Runtime>(
    app: &tauri::AppHandle<R>,
    sorted: SortedDrop,
    drop_id: String,
) -> LibraryDropResult {
    let SortedDrop {
        files,
        folders,
        unsupported,
        mut unreadable,
        without_path,
    } = sorted;
    let grant_app = app.clone();
    let to_grant = files.clone();
    let failed = tauri::async_runtime::spawn_blocking(move || {
        crate::library_grants::record_dropped_files(&grant_app, &to_grant)
    })
    .await
    .map_err(|error| error.to_string())
    .and_then(|result| result)
    .unwrap_or_else(|error| {
        log::warn!("[DropImport] Could not record dropped files: {error}");
        files.clone()
    });
    let files = files
        .into_iter()
        .filter(|file| !failed.contains(file))
        .collect();
    unreadable.extend(failed);
    LibraryDropResult {
        drop_id,
        files,
        folders,
        unsupported,
        unreadable,
        without_path,
        ..Default::default()
    }
}

/// Handles one drop: grants the files, asks about each folder, then tells the
/// webview what happened.
async fn process_drop(
    app: tauri::AppHandle<tauri::Wry>,
    drop_id: String,
    paths: Vec<Option<String>>,
) {
    use tauri::Manager;
    use tauri_specta::Event;

    let sorted = sort_dropped(&paths);
    log::info!(
        "[DropImport] Drop of {} item(s): {} media file(s), {} folder(s), {} unsupported, {} unreadable, {} without a path",
        paths.len(),
        sorted.files.len(),
        sorted.folders.len(),
        sorted.unsupported.len(),
        sorted.unreadable.len(),
        sorted.without_path.len()
    );
    let mut result = grant_dropped_files(&app, sorted, drop_id).await;
    let folders = std::mem::take(&mut result.folders);
    let window = app
        .get_webview_window("main")
        .map(|window| window.as_ref().window());
    for folder in folders {
        let Some(window) = window.clone() else {
            result.unreadable.push(folder);
            continue;
        };
        match crate::library_grants::request_library_folder_grant(
            app.clone(),
            window,
            folder.clone(),
            crate::library_grants::LibraryGrantKind::MonitoredFolder,
        )
        .await
        {
            Ok(true) => result.folders.push(folder),
            Ok(false) => result.declined_folders.push(folder),
            Err(error) => {
                log::warn!("[DropImport] Not granting dropped folder {folder}: {error}");
                result.unreadable.push(folder);
            }
        }
    }
    if let Err(error) = result.emit(&app) {
        log::warn!("[DropImport] Could not report a drop: {error}");
    }
}

/// Listens for drop messages on the main window's WebView2.
#[cfg(windows)]
pub fn register(window: &tauri::WebviewWindow<tauri::Wry>) {
    use tauri::Manager;
    use webview2_com::{
        take_pwstr, Microsoft::Web::WebView2::Win32::ICoreWebView2WebMessageReceivedEventArgs,
        WebMessageReceivedEventHandler,
    };
    use windows_core::PWSTR;

    let app = window.app_handle().clone();
    let config = app.config();
    let origin = app_origin(
        config.build.dev_url.as_ref(),
        tauri::is_dev(),
        config
            .app
            .windows
            .first()
            .is_some_and(|window| window.use_https_scheme),
    );

    fn read(get: impl FnOnce(&mut PWSTR) -> windows_core::Result<()>) -> Option<String> {
        let mut value = PWSTR::null();
        get(&mut value).ok()?;
        Some(take_pwstr(value))
    }

    let registered = window.with_webview(move |webview| {
        let Ok(core) = (unsafe { webview.controller().CoreWebView2() }) else {
            log::warn!("[DropImport] WebView2 is unavailable; drops will not import");
            return;
        };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args): Option<ICoreWebView2WebMessageReceivedEventArgs> = args else {
                return Ok(());
            };
            let Some(source) = read(|value| unsafe { args.Source(value) }) else {
                return Ok(());
            };
            let Some(message) = read(|value| unsafe { args.TryGetWebMessageAsString(value) })
            else {
                return Ok(());
            };
            let Some(drop_id) = drop_id_from_message(&source, &origin, &message) else {
                return Ok(());
            };
            let paths = native_paths(&args);
            tauri::async_runtime::spawn(process_drop(app.clone(), drop_id, paths));
            Ok(())
        }));
        let mut token = 0i64;
        if unsafe { core.add_WebMessageReceived(&handler, &mut token) }.is_err() {
            log::warn!("[DropImport] Could not listen for drops; drops will not import");
        }
    });
    if let Err(error) = registered {
        log::warn!("[DropImport] Could not reach WebView2: {error}");
    }
}

/// The path WebView2 gives for each object posted with the message, in order:
/// `None` for an object that is not a file or has no file on disk.
#[cfg(windows)]
fn native_paths(
    args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebMessageReceivedEventArgs,
) -> Vec<Option<String>> {
    use webview2_com::{
        take_pwstr,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2,
        },
    };
    use windows_core::{Interface, PWSTR};

    let Ok(args) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() else {
        return Vec::new();
    };
    let Ok(objects) = (unsafe { args.AdditionalObjects() }) else {
        return Vec::new();
    };
    let mut count = 0u32;
    if unsafe { objects.Count(&mut count) }.is_err() {
        return Vec::new();
    }
    (0..count)
        .map(|index| {
            let file = unsafe { objects.GetValueAtIndex(index) }
                .ok()?
                .cast::<ICoreWebView2File>()
                .ok()?;
            let mut path = PWSTR::null();
            unsafe { file.Path(&mut path) }.ok()?;
            Some(take_pwstr(path)).filter(|path| !path.is_empty())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const ORIGIN: &str = "http://tauri.localhost";

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ambit-drop-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_app_origin_is_the_dev_server_only_in_a_dev_build() {
        let dev = Url::parse("http://localhost:1422").unwrap();
        assert_eq!(app_origin(Some(&dev), true, false), "http://localhost:1422");
        assert_eq!(
            app_origin(Some(&dev), false, false),
            "http://tauri.localhost"
        );
        assert_eq!(app_origin(None, true, true), "https://tauri.localhost");
    }

    #[test]
    fn only_a_drop_message_from_the_app_origin_is_accepted() {
        let message = r#"{"type":"ambit-drop","id":"drop-1"}"#;
        assert_eq!(
            drop_id_from_message("http://tauri.localhost/", ORIGIN, message),
            Some("drop-1".to_string())
        );
        for source in [
            "https://example.com/",
            "http://tauri.localhost.evil.test/",
            "http://tauri.localhost:8080/",
            "https://tauri.localhost/",
            "not a url",
        ] {
            assert_eq!(
                drop_id_from_message(source, ORIGIN, message),
                None,
                "{source}"
            );
        }
    }

    #[test]
    fn tauri_commands_and_other_messages_are_not_drops() {
        let source = "http://tauri.localhost/index.html";
        for message in [
            r#"{"cmd":"scan_directory","callback":1,"error":2,"payload":{"type":"ambit-drop","id":"drop-1"}}"#,
            r#""ambit-drop""#,
            r#"{"type":"other","id":"drop-1"}"#,
            r#"{"type":"ambit-drop"}"#,
            r#"{"type":"ambit-drop","id":""}"#,
            r#"{"type":"ambit-drop","id":"../x"}"#,
            "not json",
        ] {
            assert_eq!(
                drop_id_from_message(source, ORIGIN, message),
                None,
                "{message}"
            );
        }
    }

    #[test]
    fn dropped_paths_are_sorted_by_what_ambit_does_with_them() {
        let dir = temp_dir("sort");
        let image = dir.join("a.PNG");
        let video = dir.join("b.mp4");
        let text = dir.join("notes.txt");
        let folder = dir.join("folder");
        for file in [&image, &video, &text] {
            fs::write(file, b"x").unwrap();
        }
        fs::create_dir_all(&folder).unwrap();
        let missing = dir.join("gone.png");
        let text_of = |path: &PathBuf| path.to_string_lossy().into_owned();

        let sorted = sort_dropped(&[
            Some(text_of(&image)),
            None,
            Some(text_of(&text)),
            Some(String::new()),
            Some(text_of(&folder)),
            Some(text_of(&missing)),
            Some(text_of(&video)),
        ]);

        assert_eq!(
            sorted,
            SortedDrop {
                files: vec![text_of(&image), text_of(&video)],
                folders: vec![text_of(&folder)],
                unsupported: vec![text_of(&text)],
                unreadable: vec![text_of(&missing)],
                without_path: vec![1, 3],
            }
        );
        let _ = fs::remove_dir_all(dir);
    }

    // #493: a compromised page must not grant itself files by naming paths. Paths
    // come only from the objects WebView2 resolves, so a message that lists
    // paths, with no dropped objects, grants nothing.
    #[test]
    fn paths_named_in_the_message_are_never_granted() {
        let dir = temp_dir("message-paths");
        let named = dir.join("secret.png");
        fs::write(&named, b"x").unwrap();
        let message = format!(
            r#"{{"type":"ambit-drop","id":"drop-1","paths":[{:?}],"files":[{:?}]}}"#,
            named.to_string_lossy(),
            named.to_string_lossy()
        );
        let drop_id = drop_id_from_message("http://tauri.localhost/", ORIGIN, &message)
            .expect("a well-formed drop message");

        let app = crate::library_grants::test_app("com.ambit.drop-test-message");
        let result = tauri::async_runtime::block_on(grant_dropped_files(
            app.handle(),
            sort_dropped(&[]),
            drop_id,
        ));

        assert!(result.files.is_empty());
        assert!(crate::library_grants::recorded_files(app.handle()).is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn only_supported_dropped_files_are_granted_and_folders_wait_for_confirmation() {
        let dir = temp_dir("grant");
        let image = dir.join("a.webp");
        let text = dir.join("notes.txt");
        let folder = dir.join("folder");
        fs::write(&image, b"x").unwrap();
        fs::write(&text, b"x").unwrap();
        fs::create_dir_all(&folder).unwrap();
        let text_of = |path: &PathBuf| path.to_string_lossy().into_owned();

        let app = crate::library_grants::test_app("com.ambit.drop-test-grant");
        let result = tauri::async_runtime::block_on(grant_dropped_files(
            app.handle(),
            sort_dropped(&[
                Some(text_of(&image)),
                Some(text_of(&text)),
                Some(text_of(&folder)),
                None,
            ]),
            "drop-2".to_string(),
        ));

        assert_eq!(result.files, vec![text_of(&image)]);
        assert_eq!(result.unsupported, vec![text_of(&text)]);
        assert_eq!(result.without_path, vec![3]);
        let recorded = crate::library_grants::recorded_files(app.handle());
        assert_eq!(recorded.len(), 1);
        assert!(recorded[0].ends_with("a.webp"));
        assert_eq!(
            crate::library_grants::recorded_folder_count(app.handle()),
            0,
            "a dropped folder is recorded only after the folder confirmation"
        );
        let _ = fs::remove_dir_all(dir);
    }
}
