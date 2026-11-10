import { createApp } from 'vue'
import App from './App.vue'
import { APP_SERVICES } from './ui/services.ts'
import { createTauriServices } from './infrastructure/tauri_services.ts'
import { installErrorLog } from './infrastructure/tauri_log.ts'
import { createTauriWordImport } from './infrastructure/tauri_word_import.ts'
import { WORD_IMPORT } from './ui/app_shell/word_import_port.ts'

// 最先接上错误日志：之后的错误都写入日志文件。
installErrorLog()

// 先读入应用环境与应用级状态（上次打开的项目等），再挂载界面。
void createTauriServices().then((services) => createApp(App)
  .provide(APP_SERVICES, services)
  .provide(WORD_IMPORT, createTauriWordImport(services.importer, services.storage))
  .mount('#app'))
