import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { ensureLookoutDomain } from './domain/lookout/migration'
import './styles/global.css'

// 启动先完成旧记录迁移与统一口径归一，页面拿到的永远是迁移后的数据。
ensureLookoutDomain()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
