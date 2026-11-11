import {
  mihomoRuleProviders,
  mihomoUpdateRuleProviders,
  getRuntimeConfig,
  getLocalRulesEditor,
  saveLocalRuleProvider
} from '@renderer/utils/ipc'
import { getHash } from '@renderer/utils/hash'
import React, { Fragment, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Button, Chip, Input, Spinner } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import { IoMdRefresh } from 'react-icons/io'
import { CgLoadbarDoc } from 'react-icons/cg'
import { MdEdit, MdEditDocument } from 'react-icons/md'
import dayjs from '@renderer/utils/dayjs'
import { useTranslation } from 'react-i18next'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { useActiveProfile } from '@renderer/hooks/use-active-profile'
import { FaPlus } from 'react-icons/fa6'
import SettingItem from '../base/base-setting-item'
import SettingCard from '../base/base-setting-card'
import type { LocalRuleEditor } from '../../../../shared/local-config'
import DeleteResourceButton from '../local/delete-resource-button'
import Viewer from './viewer'
import RuleProviderEditorModal from './rule-provider-editor-modal'

const RuleProvider: React.FC<{ editing?: boolean }> = (props) => {
  const { t } = useTranslation()
  const { isLocalActive } = useActiveProfile()
  const editing = !!props.editing && isLocalActive
  const {
    data: editorData,
    error: editorError,
    mutate: refreshEditor
  } = useSWR(editing ? 'getLocalRulesEditor' : null, getLocalRulesEditor)
  const [filter, setFilter] = useState('')
  const [editor, setEditor] = useState<{ name?: string; data: LocalRuleEditor }>()
  useEffect(() => {
    if (!editing) setEditor(undefined)
  }, [editing])
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
  useEffect(() => {
    const unsubscribeProviders = window.electron.ipcRenderer.on('ruleProvidersUpdated', () => {
      void mutate()
    })
    const unsubscribeLocal = window.electron.ipcRenderer.on('localConfigUpdated', () => {
      void mutate()
      if (editing) void refreshEditor()
    })
    return () => {
      unsubscribeProviders()
      unsubscribeLocal()
    }
  }, [editing, mutate, refreshEditor])
  const allProviders = useMemo(() => {
    if (editing)
      return Object.entries(editorData?.ruleProviders || {}).map(
        ([name, value]): IMihomoRuleProvider => ({
          name,
          type: 'Rule',
          behavior: String(value.behavior || 'domain'),
          format: String(value.format || 'yaml'),
          ruleCount:
            data?.providers?.[name]?.ruleCount ||
            (Array.isArray(value.payload) ? value.payload.length : 0),
          updatedAt: data?.providers?.[name]?.updatedAt || '',
          vehicleType: value.type === 'http' ? 'HTTP' : value.type === 'file' ? 'File' : 'Inline'
        })
      )
    if (!data || !data.providers) return []
    return Object.values(data.providers).sort((a, b) => {
      if (a.vehicleType === 'File' && b.vehicleType !== 'File') {
        return -1
      }
      if (a.vehicleType !== 'File' && b.vehicleType === 'File') {
        return 1
      }
      return 0
    })
  }, [data, editing, editorData])
  const providers = useMemo(() => {
    return allProviders.filter((p) => !filter || includesIgnoreCase(p.name, filter))
  }, [allProviders, filter])
  const [updating, setUpdating] = useState(Array(providers.length).fill(false))
  const updatable = providers
    .map((provider, index) => ({ provider, index }))
    .filter(
      ({ provider }) =>
        !editing || (!!data?.providers?.[provider.name] && provider.vehicleType !== 'Inline')
    )

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
  const view = (provider: IMihomoRuleProvider): void => {
    const current = data?.providers?.[provider.name] || provider
    setShowDetails({
      show: false,
      privderType: 'rule-providers',
      path: provider.name,
      type: current.vehicleType,
      title: provider.name,
      format: current.format,
      behavior: current.behavior || 'domain'
    })
  }

  if (!allProviders.length && !isLocalActive) {
    return null
  }

  return (
    <SettingCard>
      {editing && editor && (
        <RuleProviderEditorModal
          name={editor.name}
          data={editor.data}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            void refreshEditor()
            void mutate()
          }}
        />
      )}
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider pb-2">
        <h4 className="min-w-0 wrap-break-word text-md">{t('resources.ruleProviders.title')}</h4>
        <div className="flex min-w-0 items-center gap-2">
          <Input
            size="sm"
            className="w-28 sm:w-40"
            value={filter}
            placeholder={t('resources.ruleProviders.filter')}
            isClearable
            onValueChange={setFilter}
          />
          <Button
            size="sm"
            color="primary"
            isDisabled={!updatable.length}
            onPress={() => {
              updatable.forEach(({ provider, index }) => {
                onUpdate(provider.name, index)
              })
            }}
          >
            {t('resources.ruleProviders.updateAll')}
          </Button>
        </div>
      </div>
      {editing && !editorData && !editorError && (
        <div className="flex justify-center p-4">
          <Spinner aria-label="加载规则集" />
        </div>
      )}
      {editing && editorError && (
        <div role="alert" className="py-3 text-sm text-danger">
          {String(editorError)}
        </div>
      )}
      {editing ? (
        <>
          {providers.map((provider, index) => (
            <div
              key={provider.name}
              className="flex min-w-0 items-center gap-2 border-b border-divider py-3"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => editorData && setEditor({ name: provider.name, data: editorData })}
              >
                <div className="truncate text-sm font-medium" title={provider.name}>
                  {provider.name}
                </div>
                <div className="mt-1 truncate text-xs text-foreground-500">
                  {provider.vehicleType} · {provider.behavior} · {provider.format} ·{' '}
                  {provider.ruleCount}
                </div>
              </button>
              <Button
                size="sm"
                isIconOnly
                variant="light"
                title="编辑规则集"
                aria-label={`编辑规则集 ${provider.name}`}
                onPress={() => editorData && setEditor({ name: provider.name, data: editorData })}
              >
                <MdEdit className="text-lg" />
              </Button>
              <DeleteResourceButton
                label={`规则集 ${provider.name}`}
                disabled={!editorData}
                onDelete={async () => {
                  if (!editorData) return
                  await saveLocalRuleProvider(
                    provider.name,
                    provider.name,
                    null,
                    editorData.ruleProviders[provider.name]
                  )
                  await refreshEditor()
                  await mutate()
                }}
              />
              <Button
                size="sm"
                isIconOnly
                variant="light"
                title="查看内容"
                aria-label={`查看内容 ${provider.name}`}
                isDisabled={!data?.providers?.[provider.name]}
                onPress={() => view(provider)}
              >
                <CgLoadbarDoc className="text-lg" />
              </Button>
              <Button
                size="sm"
                isIconOnly
                variant="light"
                title={t('common.updater.update')}
                isDisabled={!data?.providers?.[provider.name] || provider.vehicleType === 'Inline'}
                onPress={() => onUpdate(provider.name, index)}
              >
                <IoMdRefresh className={`text-lg ${updating[index] ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          ))}
          <Button
            fullWidth
            variant="light"
            className="mt-2 h-14 text-foreground-500"
            startContent={<FaPlus />}
            isDisabled={!editorData || !!editorError}
            onPress={() => editorData && setEditor({ data: editorData })}
          >
            添加规则集
          </Button>
        </>
      ) : providers.length ? (
        providers.map((provider, index) => (
          <Fragment key={provider.name}>
            <SettingItem
              title={provider.name}
              actions={
                <Chip className="ml-2" size="sm">
                  {provider.ruleCount}
                </Chip>
              }
            >
              <div className="flex h-8 leading-8 text-foreground-500">
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
                    view(provider)
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
              <div className="h-8 leading-8 text-foreground-500">
                {provider.vehicleType}::{provider.behavior}
              </div>
            </SettingItem>
          </Fragment>
        ))
      ) : (
        <div className="py-6 text-center text-sm text-foreground/50">{t('traffic.noData')}</div>
      )}
    </SettingCard>
  )
}

export default RuleProvider
