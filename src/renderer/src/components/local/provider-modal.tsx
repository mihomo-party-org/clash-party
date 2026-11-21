import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Textarea
} from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import { getLocalConfig, saveLocalProvider } from '@renderer/utils/ipc'
import { stringify } from 'yaml'
import { useEffect, useState } from 'react'
import { parseYaml } from '../../../../shared/yaml'

/* eslint-disable react/prop-types */

type ProviderKind = 'proxy-providers' | 'rule-providers'

interface Props {
  kind: ProviderKind
  name?: string
  onClose: () => void
  onSaved: () => void
}

type ProviderValue = Record<string, unknown>

const providerTypes = [
  { key: 'http', label: 'HTTP' },
  { key: 'file', label: 'File' },
  { key: 'inline', label: 'Inline' }
]

const ruleBehaviors = [
  { key: 'domain', label: 'domain' },
  { key: 'ipcidr', label: 'ipcidr' },
  { key: 'classical', label: 'classical' }
]

const ruleFormats = [
  { key: 'yaml', label: 'YAML' },
  { key: 'text', label: 'Text' },
  { key: 'mrs', label: 'MRS' }
]

const ProviderModal: React.FC<Props> = ({ kind, name: editingName, onClose, onSaved }) => {
  const [loaded, setLoaded] = useState(false)
  const [currentProvider, setCurrentProvider] = useState<ProviderValue>()
  const [name, setName] = useState(editingName || '')
  const [type, setType] = useState('http')
  const [url, setUrl] = useState('')
  const [path, setPath] = useState('')
  const [interval, setInterval] = useState('3600')
  const [proxy, setProxy] = useState('')
  const [behavior, setBehavior] = useState('domain')
  const [format, setFormat] = useState('yaml')
  const [payload, setPayload] = useState(kind === 'rule-providers' ? '' : '[]')
  const [saving, setSaving] = useState(false)
  const isRuleProvider = kind === 'rule-providers'

  useEffect(() => {
    getLocalConfig()
      .then((next) => {
        const providers = (parseYaml(next.modules[kind]) || {}) as Record<string, ProviderValue>
        const current = editingName ? providers[editingName] : undefined
        setCurrentProvider(current)
        setLoaded(true)
        if (!current) return
        setType(String(current.type || 'http'))
        setUrl(String(current.url || ''))
        setPath(String(current.path || ''))
        setInterval(String(current.interval ?? 3600))
        setProxy(String(current.proxy || ''))
        setBehavior(String(current.behavior || 'domain'))
        setFormat(String(current.format || 'yaml'))
        setPayload(
          isRuleProvider && Array.isArray(current.payload)
            ? current.payload.join('\n')
            : stringify(current.payload || [])
        )
      })
      .catch((error) => toast.error(String(error)))
  }, [editingName, kind, isRuleProvider])

  const save = async (): Promise<void> => {
    if (!loaded || !name.trim()) {
      toast.error('名称不能为空')
      return
    }
    if (type === 'http' && !url.trim()) {
      toast.error('HTTP Provider 需要 URL')
      return
    }
    if (type === 'file' && !path.trim()) {
      toast.error('File Provider 需要路径')
      return
    }
    if (type === 'http' && (!Number.isSafeInteger(Number(interval)) || Number(interval) < 0)) {
      toast.error('更新间隔必须是非负整数')
      return
    }
    if (type === 'http') {
      try {
        if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error()
      } catch {
        toast.error('URL 必须使用 http(s)')
        return
      }
    }
    let parsedPayload: unknown = []
    if (type === 'inline') {
      if (isRuleProvider) {
        parsedPayload = payload
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      } else {
        try {
          parsedPayload = parseYaml(payload) || []
          if (
            !Array.isArray(parsedPayload) ||
            parsedPayload.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
          ) {
            throw new Error('节点必须是对象列表')
          }
        } catch (error) {
          toast.error(`Inline 内容格式错误：${String(error)}`)
          return
        }
      }
    }
    const retained = { ...currentProvider }
    for (const key of ['type', 'url', 'path', 'interval', 'proxy', 'behavior', 'format'])
      delete retained[key]
    const value: ProviderValue = {
      ...retained,
      type,
      ...(type === 'http' ? { url: url.trim(), interval: Number(interval) } : {}),
      ...(type !== 'inline' && path.trim() ? { path: path.trim() } : {}),
      ...(type === 'inline' ? { payload: parsedPayload } : {}),
      ...(type === 'http' && proxy.trim() ? { proxy: proxy.trim() } : {}),
      ...(isRuleProvider
        ? { behavior, ...(type !== 'inline' && format.trim() ? { format: format.trim() } : {}) }
        : {})
    }
    setSaving(true)
    try {
      await saveLocalProvider(kind, editingName, name.trim(), value, currentProvider)
      toast.success('已保存')
      onSaved()
      onClose()
    } catch (error) {
      toast.error(String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen hideCloseButton size="3xl" backdrop="blur" onClose={onClose}>
      <ModalContent>
        <ModalHeader className="app-drag">
          {editingName ? '编辑' : '添加'}
          {isRuleProvider ? '规则集合' : '订阅'}
        </ModalHeader>
        <ModalBody>
          <div className="grid grid-cols-2 gap-3">
            <Input label="名称" value={name} onValueChange={setName} />
            <Select
              label="类型"
              disallowEmptySelection
              selectedKeys={[type]}
              onChange={(e) => setType(e.target.value)}
            >
              {providerTypes.map((item) => (
                <SelectItem key={item.key}>{item.label}</SelectItem>
              ))}
            </Select>
            {type === 'http' && (
              <Input className="col-span-2" label="URL" value={url} onValueChange={setUrl} />
            )}
            {type !== 'inline' && (
              <Input
                className="col-span-2"
                label={type === 'http' ? '缓存路径（可选）' : '路径'}
                value={path}
                onValueChange={setPath}
              />
            )}
            {type === 'http' && (
              <Input
                label="更新间隔（秒）"
                type="number"
                value={interval}
                onValueChange={setInterval}
              />
            )}
            {type === 'http' && <Input label="下载代理" value={proxy} onValueChange={setProxy} />}
            {isRuleProvider && (
              <>
                <Select
                  label="行为"
                  disallowEmptySelection
                  selectedKeys={[behavior]}
                  onChange={(e) => {
                    setBehavior(e.target.value)
                    if (e.target.value === 'classical' && format === 'mrs') setFormat('yaml')
                  }}
                >
                  {ruleBehaviors.map((item) => (
                    <SelectItem key={item.key}>{item.label}</SelectItem>
                  ))}
                </Select>
                {type !== 'inline' && (
                  <Select
                    label="格式"
                    disallowEmptySelection
                    disabledKeys={behavior === 'classical' ? ['mrs'] : []}
                    selectedKeys={[format]}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    {ruleFormats.map((item) => (
                      <SelectItem key={item.key}>{item.label}</SelectItem>
                    ))}
                  </Select>
                )}
              </>
            )}
            {type === 'inline' && (
              <Textarea
                className="col-span-2 font-mono"
                label={isRuleProvider ? '规则（每行一条）' : '节点列表（YAML）'}
                minRows={6}
                value={payload}
                onValueChange={setPayload}
              />
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            取消
          </Button>
          <Button color="primary" isDisabled={!loaded} isLoading={saving} onPress={save}>
            保存
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default ProviderModal
