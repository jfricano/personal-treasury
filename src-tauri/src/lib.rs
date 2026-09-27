mod lock;
mod provider;
/// The desktop shell only hosts the web UI and grants file access through
/// explicit plugins. All treasury logic and the SQLite database live in the
/// web layer (see docs/decisions/0001-embedded-sqlite.md). Provider requests
/// use an explicit native host/path allowlist.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(provider::ProviderLimits::default())
        .setup(|app| {
            lock::observe(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            provider::plaid_request,
            provider::open_hosted_link
        ])
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running Personal Treasury");
}
