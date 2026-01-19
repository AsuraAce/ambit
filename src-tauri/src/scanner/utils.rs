use std::path::Path;
use rayon::prelude::*;

pub fn verify_image_paths_impl(paths: Vec<String>) -> Vec<String> {
    paths
        .par_iter()
        .filter(|path| !Path::new(path).exists())
        .map(|path| path.clone())
        .collect()
}

pub fn get_file_sizes_bulk_impl(paths: Vec<String>) -> Vec<u64> {
    let mut sizes = Vec::with_capacity(paths.len());
    for path in paths {
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        sizes.push(size);
    }
    sizes
}

pub fn open_file_impl(path: String) -> Result<(), String> {
    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        return Err("File not found".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let windows_path = path.replace("/", "\\");
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &windows_path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn show_in_folder_impl(path: String) -> Result<(), String> {
    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        return Err("File not found".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let windows_path = path.replace("/", "\\");
        std::process::Command::new("cmd")
            .args(["/c", "explorer", "/select,", &windows_path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent = path_obj.parent().ok_or("No parent directory")?;
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
