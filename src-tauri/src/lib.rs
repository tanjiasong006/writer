use tauri::Manager;

mod app_env;
mod commands;
mod export;
mod io_kind;
mod render;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    // 开发构建是独立的应用 "Writer Dev"：不与正式版共享任何应用级数据（见 app_env）。
    app_env::apply(&mut context);
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
            commands::project_close,
            commands::app_state_read,
            commands::app_state_write,
            commands::project_read_ui_state,
            commands::project_write_ui_state,
            commands::project_import_asset,
            commands::export_docx,
            commands::export_pdf,
            commands::reveal_in_file_manager,
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            // Cmd+Q / 菜单"退出"会直接请求退出应用，绕过窗口的关闭流程。
            // 主窗口还在时先阻止退出，改走窗口关闭：前端保存未保存的修改、失败时询问用户，
            // 由它决定是否真正关闭窗口；窗口销毁后再次到来的退出请求正常放行。
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    api.prevent_exit();
                    let _ = window.close();
                }
            }
        });
}
