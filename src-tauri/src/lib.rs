use tauri::Manager;

mod commands;
mod export;
mod render;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 扫描系统字体需要数秒：启动后在后台预热，首次导出 PDF 不必等待。
            let resource_dir = app.path().resource_dir().ok();
            std::thread::spawn(move || {
                export::pdf::font_store(resource_dir.as_deref());
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project_create,
            commands::project_open,
            commands::project_save,
            commands::project_read_ui_state,
            commands::project_write_ui_state,
            commands::project_import_asset,
            commands::render_preview,
            commands::export_docx,
            commands::export_pdf,
            commands::reveal_in_file_manager,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
