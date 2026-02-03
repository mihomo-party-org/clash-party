import { Card, CardBody, Chip, Switch } from '@heroui/react'
import React, { useState, useEffect } from 'react'
import { mihomoRulesDisable } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'

interface RuleItemProps extends IMihomoRulesDetail {
  index: number
}

const RuleItem: React.FC<RuleItemProps> = (props) => {
  const { t } = useTranslation()
  const { type, payload, proxy, index: listIndex, extra } = props
  const ruleIndex = props.index ?? listIndex

  const { disabled, hitCount, hitAt, missCount, missAt } = extra

  const [isEnabled, setIsEnabled] = useState(!disabled)

  useEffect(() => {
    setIsEnabled(!disabled)
  }, [disabled])

  const handleToggle = async (v: boolean): Promise<void> => {
    setIsEnabled(v)
    try {
      await mihomoRulesDisable({ [ruleIndex]: !v })
    } catch (error) {
      console.error('Failed to toggle rule:', error)
      setIsEnabled(!v)
    }
  }

  const totalCount = hitCount + missCount
  const hitRate = totalCount > 0 ? (hitCount / totalCount) * 100 : 0

  const formatRelativeTime = (timestamp: string): string => {
    const now = Date.now()
    const time = new Date(timestamp).getTime()
    const diff = Math.floor((now - time) / 1000)
    if (diff < 60) return t('rules.hitAt.seconds')
    if (diff < 3600) return t('rules.hitAt.minutes', { count: Math.floor(diff / 60) })
    if (diff < 86400) return t('rules.hitAt.hours', { count: Math.floor(diff / 3600) })
    return t('rules.hitAt.days', { count: Math.floor(diff / 86400) })
  }

  const hasStats = totalCount > 0

  return (
    <div className={`w-full px-2 pb-2 ${listIndex === 0 ? 'pt-2' : ''}`}>
      <Card className={!isEnabled ? 'opacity-50' : ''}>
        <CardBody className="py-3 px-4">
          <div className="flex justify-between items-center gap-4">
            {/* 左侧：规则信息 */}
            <div className="flex-1 min-w-0 flex items-center gap-3">
              {/* 规则内容 */}
              <div className="flex-1 min-w-0">
                <div title={payload} className="text-sm font-medium truncate mb-1.5">
                  {payload}
                </div>
                <div className="flex items-center gap-2">
                  <Chip size="sm" variant="flat" color="default" className="text-xs">
                    {type}
                  </Chip>
                  <Chip size="sm" variant="flat" color="default" className="text-xs">
                    {proxy}
                  </Chip>
                </div>
              </div>

              {/* 统计信息 */}
              {hasStats && (
                <div className="flex items-center gap-3 text-xs shrink-0">
                  <span className="text-foreground-500 whitespace-nowrap">
                    {formatRelativeTime(hitAt || missAt)}
                  </span>
                  <span className="text-foreground-600 font-medium whitespace-nowrap">
                    {hitCount}/{totalCount}
                  </span>
                  <Chip size="sm" variant="flat" color="primary" className="text-xs">
                    {hitRate.toFixed(1)}%
                  </Chip>
                </div>
              )}
            </div>

            {/* 右侧开关 */}
            <Switch
              size="sm"
              isSelected={isEnabled}
              onValueChange={handleToggle}
              aria-label="Toggle rule"
            />
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

export default RuleItem
