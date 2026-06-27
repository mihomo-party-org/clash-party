import dayjs from './dayjs'

interface ProfileUpdateStatusView {
  color: 'success' | 'danger' | 'default'
  label: string
  tooltip: string
}

export function getProfileUpdateStatusView(
  info: IProfileItem,
  t: (key: string, options?: Record<string, unknown>) => string
): ProfileUpdateStatusView | undefined {
  if (info.type !== 'remote' || !info.lastUpdateStatus) return undefined

  const time = info.lastUpdateAt ? dayjs(info.lastUpdateAt).fromNow() : undefined
  const statusKey =
    info.lastUpdateStatus === 'success'
      ? 'profiles.updateStatus.success'
      : 'profiles.updateStatus.failed'
  const label = time ? `${t(statusKey)} · ${time}` : t(statusKey)
  const tooltip =
    info.lastUpdateStatus === 'failed' && info.lastUpdateError
      ? t('profiles.updateStatus.failedWithError', { error: info.lastUpdateError })
      : label

  return {
    color: info.lastUpdateStatus === 'success' ? 'success' : 'danger',
    label,
    tooltip
  }
}
