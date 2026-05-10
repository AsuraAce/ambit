use keyring::Entry;
use tauri::command;

const SERVICE_NAME: &str = "Ambit";
const ACCOUNT_NAME: &str = "gemini_api_key";

#[command(rename_all = "camelCase")]
#[specta::specta]
pub async fn save_api_key(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, ACCOUNT_NAME).map_err(|e| e.to_string())?;
    entry.set_password(&key).map_err(|e| e.to_string())?;
    Ok(())
}

#[command(rename_all = "camelCase")]
#[specta::specta]
pub async fn load_api_key() -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, ACCOUNT_NAME).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[command(rename_all = "camelCase")]
#[specta::specta]
pub async fn delete_api_key() -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, ACCOUNT_NAME).map_err(|e| e.to_string())?;
    match entry.delete_password() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already gone
        Err(e) => Err(e.to_string()),
    }
}
