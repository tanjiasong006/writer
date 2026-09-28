import { createApp } from 'vue'
import App from './App.vue'
import { APP_SERVICES } from './ui/services.ts'
import { createTauriServices } from './infrastructure/tauri_services.ts'

createApp(App).provide(APP_SERVICES, createTauriServices()).mount('#app')
