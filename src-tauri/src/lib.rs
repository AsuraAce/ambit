mod metadata;
mod db;
mod scanner;
mod watcher;

use watcher::WatcherState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().add_migrations("sqlite:images.db", db::init_db()).build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            db::save_images_batch,
            db::refresh_boards_native,
            scanner::scan_image,
            scanner::scan_images_bulk,
            scanner::scan_image_workflow,
            scanner::read_image_metadata,
            scanner::get_file_sizes_bulk,
            scanner::verify_image_paths,
            scanner::audit_invokeai_folder,
            scanner::list_invokeai_images,
            scanner::scan_directory_recursive,
            scanner::open_file,
            scanner::show_in_folder,
            watcher::start_native_folder_watcher,
            metadata::models::import_a1111_cache,
            metadata::models::resolve_hashes_online,
            metadata::models::clear_model_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
