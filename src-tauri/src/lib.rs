mod commands;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::project_create,
            commands::project_open,
            commands::project_save,
            commands::project_read_ui_state,
            commands::project_write_ui_state,
            commands::project_import_asset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
