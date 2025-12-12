import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import relativeTime from 'dayjs/plugin/relativeTime'
import i18n from '@renderer/i18n'

// 加载相对时间插件
dayjs.extend(relativeTime)

// 根据当前语言设置 dayjs 语言
const updateDayjsLocale = (): void => {
  const currentLanguage = i18n.language
  dayjs.locale(currentLanguage === 'zh-CN' ? 'zh-cn' : 'en')
}

// 初始设置语言
updateDayjsLocale()

// 监听语言变化
i18n.on('languageChanged', updateDayjsLocale)

export default dayjs
