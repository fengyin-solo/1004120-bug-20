import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { recallPosition } from './data/last-position'
import './styles/global.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 跨会话定位：从首页进入时回到上次所在的模块；按命名路由跳转，只会指向登记在册的模块。
void router.isReady().then(() => {
  const lastModule = recallPosition()
  if (lastModule && router.currentRoute.value.name === 'dashboard') {
    void router.replace({ name: lastModule })
  }
})

app.mount('#app')
