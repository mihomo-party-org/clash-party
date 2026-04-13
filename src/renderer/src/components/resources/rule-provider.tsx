import {
  mihomoRuleProviders,
  mihomoUpdateRuleProviders,
  getRuntimeConfig
} from '@renderer/utils/ipc'
import { getHash } from '@renderer/utils/hash'
import { Fragment, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Button, Chip, Input } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import { IoMdRefresh } from 'react-icons/io'
import { CgLoadbarDoc } from 'react-icons/cg'
import { MdEditDocument } from 'react-icons/md'
import dayjs from '@renderer/utils/dayjs'
import { useTranslation } from 'react-i18next'
import { includesIgnoreCase } from '@renderer/utils/includes'
import SettingItem from '../base/base-setting-item'
import SettingCard from '../base/base-setting-card'
import Viewer from './viewer'

const RuleProvider: React.FC = () => {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [showDetails, setShowDetails] = useState({
    show: false,
    path: '',
    type: '',
    title: '',
    format: '',
    privderType: '',
    behavior: ''
  })
  useEffect(() => {
    if (showDetails.title) {
      const fetchProviderPath = async (name: string): Promise<void> => {
        try {
          const providers = await getRuntimeConfig()
          const provider = providers['rule-providers'][name]
          if (provider) {
            setShowDetails((prev) => ({
              ...prev,
              show: true,
              path: provider?.path || `rules/${getHash(provider?.url)}`,
              behavior: provider?.behavior || 'domain'
            }))
          }
        } catch {
          setShowDetails((prev) => ({ ...prev, path: '', behavior: '' }))
        }
      }
      fetchProviderPath(showDetails.title)
    }
  }, [showDetails.title])

  const { data, mutate } = useSWR('mihomoRuleProviders', mihomoRuleProviders)
  const providers = useMemo(() => {
    if (!data || !data.providers) return []
    return Object.values(data.providers)
      .filter((p) => !filter || includesIgnoreCase(p.name, filter))
      .sort((a, b) => {
        if (a.vehicleType === 'File' && b.vehicleType !== 'File') {
          return -1
        }
        if (a.vehicleType !== 'File' && b.vehicleType === 'File') {
          return 1
        }
        return 0
      })
  }, [data, filter])
  const [updating, setUpdating] = useState(Array(providers.length).fill(false))

  const onUpdate = async (name: string, index: number): Promise<void> => {
    setUpdating((prev) => {
      prev[index] = true
      return [...prev]
    })
    try {
      await mihomoUpdateRuleProviders(name)
      mutate()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setUpdating((prev) => {
        prev[index] = false
        return [...prev]
      })
    }
  }

  if (!providers.length) {
    return null
  }

  return (
    <SettingCard>
      {showDetails.show && (
        <Viewer
          path={showDetails.path}
          type={showDetails.type}
          title={showDetails.title}
          format={showDetails.format}
          privderType={showDetails.privderType}
          behavior={showDetails.behavior}
          onClose={() =>
            setShowDetails({
              show: false,
              path: '',
              type: '',
              title: '',
              format: '',
              privderType: '',
              behavior: ''
            })
          }
        />
      )}
      <SettingItem title={t('resources.ruleProviders.title')} divider>
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            className="w-40"
            value={filter}
            placeholder={t('resources.ruleProviders.filter')}
            isClearable
            onValueChange={setFilter}
          />
          <Button
            size="sm"
            color="primary"
            onPress={() => {
              providers.forEach((provider, index) => {
                onUpdate(provider.name, index)
              })
            }}
          >
            {t('resources.ruleProviders.updateAll')}
          </Button>
        </div>
      </SettingItem>
      {providers.map((provider, index) => (
        <Fragment key={provider.name}>
          <SettingItem
            title={provider.name}
            actions={
              <Chip className="ml-2" size="sm">
                {provider.ruleCount}
              </Chip>
            }
          >
            <div className="flex h-[32px] leading-[32px] text-foreground-500">
              <div>{dayjs(provider.updatedAt).fromNow()}</div>
              <Button
                isIconOnly
                title={
                  provider.vehicleType === 'File'
                    ? t('common.editor.edit')
                    : t('common.viewer.view')
                }
                className="ml-2"
                size="sm"
                onPress={() => {
                  setShowDetails({
                    show: false,
                    privderType: 'rule-providers',
                    path: provider.name,
                    type: provider.vehicleType,
                    title: provider.name,
                    format: provider.format,
                    behavior: provider.behavior || 'domain'
                  })
                }}
              >
                {provider.vehicleType === 'File' ? (
                  <MdEditDocument className={`text-lg`} />
                ) : (
                  <CgLoadbarDoc className={`text-lg`} />
                )}
              </Button>
              <Button
                isIconOnly
                title={t('common.updater.update')}
                className="ml-2"
                size="sm"
                onPress={() => {
                  onUpdate(provider.name, index)
                }}
              >
                <IoMdRefresh className={`text-lg ${updating[index] ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </SettingItem>
          <SettingItem
            title={<div className="text-foreground-500">{provider.format}</div>}
            divider={index !== providers.length - 1}
          >
            <div className="h-[32px] leading-[32px] text-foreground-500">
              {provider.vehicleType}::{provider.behavior}
            </div>
          </SettingItem>
        </Fragment>
      ))}
    </SettingCard>
  )
}

export default RuleProvider
