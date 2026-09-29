import { createApp } from 'vue'
import App from './App.vue'
import { APP_SERVICES } from './ui/services.ts'
import { createTauriServices } from './infrastructure/tauri_services.ts'

// 先读入应用环境与应用级状态（上次打开的项目等），再挂载界面。
void createTauriServices().then((services) => createApp(App).provide(APP_SERVICES, services).mount('#app'))
