import { initReactI18next } from 'react-i18next'
import i18n, { initI18n } from '../../shared/i18n'
import { getAppConfig } from './utils/ipc'

// 初始化 React i18next
i18n.use(initReactI18next)

// 从配置中读取语言设置并初始化
getAppConfig().then((config) => {
  initI18n({ lng: config.language })
})

// 通知主进程语言变更
i18n.on('languageChanged', (lng) => {
  window.electron.ipcRenderer.invoke('changeLanguage', lng)
})

export default i18n
