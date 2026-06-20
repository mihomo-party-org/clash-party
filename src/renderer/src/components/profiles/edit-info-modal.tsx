import {
  cn,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Switch,
  Select,
  SelectItem,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem
} from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import React, { useState } from 'react'
import { useOverrideConfig } from '@renderer/hooks/use-override-config'
import {
  mihomoHotReloadConfig,
  addProfileUpdater,
  getFilePath,
  readTextFile
} from '@renderer/utils/ipc'
import { MdDeleteForever } from 'react-icons/md'
import { FaPlus } from 'react-icons/fa6'
import { useTranslation } from 'react-i18next'
import { isValidCron } from 'cron-validator'
import SettingItem from '../base/base-setting-item'

interface Props {
  item: IProfileItem
  mode?: 'edit' | 'import'
  updateProfileItem?: (item: IProfileItem) => Promise<void>
  addProfileItem?: (item: Partial<IProfileItem>) => Promise<void>
  onClose: () => void
}
const EditInfoModal: React.FC<Props> = (props) => {
  const { item, mode = 'edit', updateProfileItem, addProfileItem, onClose } = props
  const { overrideConfig } = useOverrideConfig()
  const { items: overrideItems = [] } = overrideConfig || {}
  const [values, setValues] = useState({
    ...item
  })
  const inputWidth = 'w-[400px] md:w-[400px] lg:w-[600px] xl:w-[800px]'
  const { t } = useTranslation()
  const isImportMode = mode === 'import'
  const canSave =
    !isImportMode || (values.type === 'remote' ? Boolean(values.url?.trim()) : values.file != null)

  const onSave = async (): Promise<void> => {
    try {
      const updatedItem = {
        ...values,
        override: values.override?.filter(
          (i) =>
            overrideItems.find((t) => t.id === i) && !overrideItems.find((t) => t.id === i)?.global
        )
      }
      if (isImportMode) {
        if (!addProfileItem) throw new Error('Missing profile import handler')
        await addProfileItem(updatedItem)
      } else {
        if (!updateProfileItem) throw new Error('Missing profile update handler')
        await updateProfileItem(updatedItem)
        await addProfileUpdater(updatedItem)
        await mihomoHotReloadConfig()
      }
      onClose()
    } catch (e) {
      toast.error(String(e))
    }
  }

  const selectLocalFile = async (): Promise<void> => {
    const files = await getFilePath(['yml', 'yaml'])
    if (!files?.length) return

    const file = await readTextFile(files[0])
    const fileName = files[0].split('/').pop()?.split('\\').pop()
    setValues({
      ...values,
      type: 'local',
      file,
      name: values.name || fileName || values.name
    })
  }

  return (
    <Modal
      backdrop="blur"
      size="5xl"
      classNames={{
        backdrop: 'top-[48px]',
        base: 'w-[600px] md:w-[600px] lg:w-[800px] xl:w-[1024px]'
      }}
      hideCloseButton
      isOpen={true}
      onOpenChange={onClose}
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader className="flex app-drag">
          {isImportMode ? t('profiles.import') : t('profiles.editInfo.title')}
        </ModalHeader>
        <ModalBody>
          {isImportMode && (
            <SettingItem title={t('profiles.editInfo.type')}>
              <Select
                classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
                size="sm"
                className={cn(inputWidth)}
                selectedKeys={new Set([values.type])}
                disallowEmptySelection={true}
                onSelectionChange={(v) => {
                  setValues({
                    ...values,
                    type: v.currentKey as 'remote' | 'local'
                  })
                }}
              >
                <SelectItem key="remote">{t('profiles.remote')}</SelectItem>
                <SelectItem key="local">{t('profiles.local')}</SelectItem>
              </Select>
            </SettingItem>
          )}
          <SettingItem title={t('profiles.editInfo.name')}>
            <Input
              size="sm"
              className={cn(inputWidth)}
              value={values.name}
              onValueChange={(v) => {
                setValues({ ...values, name: v })
              }}
            />
          </SettingItem>
          <SettingItem title={t('profiles.editInfo.ageSecretKey')}>
            <Input
              size="sm"
              type="password"
              className={cn(inputWidth)}
              value={values.ageSecretKey || ''}
              onValueChange={(v) => {
                setValues({ ...values, ageSecretKey: v || undefined })
              }}
              placeholder={t('profiles.editInfo.ageSecretKeyPlaceholder')}
            />
          </SettingItem>
          {isImportMode && values.type === 'local' && (
            <SettingItem title={t('profiles.editInfo.file')}>
              <div className={cn(inputWidth, 'flex justify-end')}>
                <Button
                  size="sm"
                  variant={values.file ? 'flat' : 'solid'}
                  onPress={selectLocalFile}
                >
                  {values.file
                    ? values.name || t('profiles.editInfo.selectFile')
                    : t('profiles.editInfo.selectFile')}
                </Button>
              </div>
            </SettingItem>
          )}
          {values.type === 'remote' && (
            <>
              <SettingItem title={t('profiles.editInfo.url')}>
                <Input
                  size="sm"
                  className={cn(inputWidth)}
                  value={values.url}
                  onValueChange={(v) => {
                    setValues({ ...values, url: v })
                  }}
                />
              </SettingItem>
              <SettingItem title={t('profiles.editInfo.authToken')}>
                <Input
                  size="sm"
                  type="password"
                  className={cn(inputWidth)}
                  value={values.authToken || ''}
                  onValueChange={(v) => {
                    setValues({ ...values, authToken: v })
                  }}
                  placeholder={t('profiles.editInfo.authTokenPlaceholder')}
                />
              </SettingItem>
              <SettingItem title={t('profiles.editInfo.userAgent')}>
                <Input
                  size="sm"
                  className={cn(inputWidth)}
                  value={values.userAgent || ''}
                  onValueChange={(v) => {
                    setValues({ ...values, userAgent: v || undefined })
                  }}
                  placeholder={t('profiles.editInfo.userAgentPlaceholder')}
                />
              </SettingItem>
              <SettingItem title={t('profiles.editInfo.useProxy')}>
                <Switch
                  size="sm"
                  isSelected={values.useProxy ?? false}
                  onValueChange={(v) => {
                    setValues({ ...values, useProxy: v })
                  }}
                />
              </SettingItem>
              <SettingItem title={t('profiles.editInfo.autoUpdate')}>
                <Switch
                  size="sm"
                  isSelected={values.autoUpdate ?? false}
                  onValueChange={(v) => {
                    setValues({ ...values, autoUpdate: v })
                  }}
                />
              </SettingItem>
              {values.autoUpdate && (
                <>
                  <SettingItem title={t('profiles.editInfo.interval')}>
                    <div className="flex flex-col gap-2">
                      <Input
                        size="sm"
                        type="text"
                        className={cn(
                          inputWidth,
                          // 不合法
                          typeof values.interval === 'string' &&
                            !/^\d+$/.test(values.interval) &&
                            !isValidCron(values.interval, { seconds: false }) &&
                            'border-red-500'
                        )}
                        value={values.interval?.toString() ?? ''}
                        onValueChange={(v) => {
                          // 输入限制
                          if (/^[\d\s*\-,/]*$/.test(v)) {
                            // 纯数字
                            if (/^\d+$/.test(v)) {
                              setValues({ ...values, interval: parseInt(v, 10) || 0 })
                              return
                            }
                            // 非纯数字
                            try {
                              setValues({ ...values, interval: v })
                            } catch {
                              // ignore
                            }
                          }
                        }}
                        placeholder={t('profiles.editInfo.intervalPlaceholder')}
                      />

                      {/* 动态提示信息 */}
                      <div
                        className="text-xs"
                        style={{
                          color:
                            typeof values.interval === 'string' &&
                            !/^\d+$/.test(values.interval) &&
                            !isValidCron(values.interval, { seconds: false })
                              ? '#ef4444'
                              : '#6b7280'
                        }}
                      >
                        {typeof values.interval === 'number'
                          ? t('profiles.editInfo.intervalMinutes')
                          : /^\d+$/.test(values.interval?.toString() || '')
                            ? t('profiles.editInfo.intervalMinutes')
                            : isValidCron(values.interval?.toString() || '', { seconds: false })
                              ? t('profiles.editInfo.intervalCron')
                              : t('profiles.editInfo.intervalHint')}
                      </div>
                    </div>
                  </SettingItem>
                  <SettingItem title={t('profiles.editInfo.fixedInterval')}>
                    <Switch
                      size="sm"
                      isSelected={values.allowFixedInterval ?? false}
                      onValueChange={(v) => {
                        setValues({ ...values, allowFixedInterval: v })
                      }}
                    />
                  </SettingItem>
                </>
              )}
              <SettingItem title={t('profiles.editInfo.updateTimeout')}>
                <Input
                  size="sm"
                  type="text"
                  className={cn(inputWidth)}
                  value={values.updateTimeout?.toString() ?? ''}
                  onValueChange={(v) => {
                    if (v === '') {
                      setValues({ ...values, updateTimeout: undefined })
                      return
                    }
                    if (/^\d+$/.test(v)) {
                      setValues({ ...values, updateTimeout: parseInt(v, 10) })
                    }
                  }}
                  placeholder={t('profiles.editInfo.updateTimeoutPlaceholder')}
                />
              </SettingItem>
            </>
          )}
          <SettingItem title={t('profiles.editInfo.override.title')}>
            <div>
              {overrideItems
                .filter((i) => i.global)
                .map((i) => {
                  return (
                    <div className="flex mb-2" key={i.id}>
                      <Button disabled fullWidth variant="flat" size="sm">
                        {i.name} ({t('profiles.editInfo.override.global')})
                      </Button>
                    </div>
                  )
                })}
              {values.override?.map((i) => {
                if (!overrideItems.find((t) => t.id === i)) return null
                if (overrideItems.find((t) => t.id === i)?.global) return null
                return (
                  <div className="flex mb-2" key={i}>
                    <Button disabled fullWidth variant="flat" size="sm">
                      {overrideItems.find((t) => t.id === i)?.name}
                    </Button>
                    <Button
                      color="warning"
                      variant="flat"
                      className="ml-2"
                      size="sm"
                      onPress={() => {
                        setValues({
                          ...values,
                          override: values.override?.filter((t) => t !== i)
                        })
                      }}
                    >
                      <MdDeleteForever className="text-lg" />
                    </Button>
                  </div>
                )
              })}
              <Dropdown>
                <DropdownTrigger>
                  <Button fullWidth size="sm" variant="flat" color="default">
                    <FaPlus />
                  </Button>
                </DropdownTrigger>
                <DropdownMenu
                  emptyContent={t('profiles.editInfo.override.noAvailable')}
                  onAction={(key) => {
                    setValues({
                      ...values,
                      override: Array.from(values.override || []).concat(key.toString())
                    })
                  }}
                >
                  {overrideItems
                    .filter((i) => !values.override?.includes(i.id) && !i.global)
                    .map((i) => (
                      <DropdownItem key={i.id}>{i.name}</DropdownItem>
                    ))}
                </DropdownMenu>
              </Dropdown>
            </div>
          </SettingItem>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" color="primary" isDisabled={!canSave} onPress={onSave}>
            {isImportMode ? t('profiles.import') : t('common.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditInfoModal
