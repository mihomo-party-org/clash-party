import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Chip,
  Input,
  Select,
  SelectItem,
  Autocomplete,
  AutocompleteItem,
  Checkbox,
  Divider,
  Spinner
} from '@heroui/react'
import React, {
  useEffect,
  useState,
  useMemo,
  useCallback,
  startTransition,
  memo,
  useDeferredValue
} from 'react'
import { getProfileStr, setRuleStr, getRuleStr } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'
import yaml from 'js-yaml'
import { IoMdTrash, IoMdArrowUp, IoMdArrowDown, IoMdUndo } from 'react-icons/io'
import { MdVerticalAlignTop, MdVerticalAlignBottom } from 'react-icons/md'
import { platform } from '@renderer/utils/init'
import { toast } from '@renderer/components/base/toast'

interface Props {
  id: string
  onClose: () => void
}

interface RuleItem {
  type: string
  payload: string
  proxy: string
  additionalParams?: string[]
  offset?: number
}

const domainValidator = (value: string): boolean => {
  if (value.length > 253 || value.length < 2) return false

  return (
    new RegExp('^(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)\\.)+[a-zA-Z]{2,}$').test(
      value
    ) || ['localhost', 'local', 'localdomain'].includes(value.toLowerCase())
  )
}

const domainSuffixValidator = (value: string): boolean => {
  return new RegExp(
    '^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.[a-zA-Z]{2,}$'
  ).test(value)
}

const domainKeywordValidator = (value: string): boolean => {
  return value.length > 0 && !value.includes(',') && !value.includes(' ')
}

const domainRegexValidator = (value: string): boolean => {
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}

const portValidator = (value: string): boolean => {
  return new RegExp(
    '^(?:[1-9]\\d{0,3}|[1-5]\\d{4}|6[0-4]\\d{3}|65[0-4]\\d{2}|655[0-2]\\d|6553[0-5])$'
  ).test(value)
}

const ipv4CIDRValidator = (value: string): boolean => {
  return new RegExp(
    '^(?:(?:[1-9]?[0-9]|1[0-9][0-9]|2(?:[0-4][0-9]|5[0-5]))\\.){3}(?:[1-9]?[0-9]|1[0-9][0-9]|2(?:[0-4][0-9]|5[0-5]))(?:\\/(?:[12]?[0-9]|3[0-2]))$'
  ).test(value)
}

const ipv6CIDRValidator = (value: string): boolean => {
  return new RegExp(
    '^([0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){7}|::|:(?::[0-9a-fA-F]{1,4}){1,6}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,5}|(?:[0-9a-fA-F]{1,4}:){2}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){3}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){4}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){5}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,6}:)\\/(?:12[0-8]|1[01][0-9]|[1-9]?[0-9])$'
  ).test(value)
}

// 内置路由规则 https://wiki.metacubex.one/config/rules/
const ruleDefinitionsMap = new Map<
  string,
  {
    name: string
    required?: boolean
    example?: string
    noResolve?: boolean
    src?: boolean
    validator?: (value: string) => boolean
  }
>([
  [
    'DOMAIN',
    {
      name: 'DOMAIN',
      example: 'example.com',
      validator: (value) => domainValidator(value)
    }
  ],
  [
    'DOMAIN-SUFFIX',
    {
      name: 'DOMAIN-SUFFIX',
      example: 'example.com',
      validator: (value) => domainSuffixValidator(value)
    }
  ],
  [
    'DOMAIN-KEYWORD',
    {
      name: 'DOMAIN-KEYWORD',
      example: 'example',
      validator: (value) => domainKeywordValidator(value)
    }
  ],
  [
    'DOMAIN-REGEX',
    {
      name: 'DOMAIN-REGEX',
      example: 'example.*',
      validator: (value) => domainRegexValidator(value)
    }
  ],
  [
    'GEOSITE',
    {
      name: 'GEOSITE',
      example: 'youtube'
    }
  ],
  [
    'GEOIP',
    {
      name: 'GEOIP',
      example: 'CN',
      noResolve: true,
      src: true
    }
  ],
  [
    'SRC-GEOIP',
    {
      name: 'SRC-GEOIP',
      example: 'CN'
    }
  ],
  [
    'IP-ASN',
    {
      name: 'IP-ASN',
      example: '13335',
      noResolve: true,
      src: true,
      validator: (value) => (+value ? true : false)
    }
  ],
  [
    'SRC-IP-ASN',
    {
      name: 'SRC-IP-ASN',
      example: '9808',
      validator: (value) => (+value ? true : false)
    }
  ],
  [
    'IP-CIDR',
    {
      name: 'IP-CIDR',
      example: '127.0.0.0/8',
      noResolve: true,
      src: true,
      validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value)
    }
  ],
  [
    'IP-CIDR6',
    {
      name: 'IP-CIDR6',
      example: '2620:0:2d0:200::7/32',
      noResolve: true,
      src: true,
      validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value)
    }
  ],
  [
    'SRC-IP-CIDR',
    {
      name: 'SRC-IP-CIDR',
      example: '192.168.1.201/32',
      validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value)
    }
  ],
  [
    'IP-SUFFIX',
    {
      name: 'IP-SUFFIX',
      example: '8.8.8.8/24',
      noResolve: true,
      src: true,
      validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value)
    }
  ],
  [
    'SRC-IP-SUFFIX',
    {
      name: 'SRC-IP-SUFFIX',
      example: '192.168.1.201/8',
      validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value)
    }
  ],
  [
    'SRC-PORT',
    {
      name: 'SRC-PORT',
      example: '7777',
      validator: (value) => portValidator(value)
    }
  ],
  [
    'DST-PORT',
    {
      name: 'DST-PORT',
      example: '80',
      validator: (value) => portValidator(value)
    }
  ],
  [
    'IN-PORT',
    {
      name: 'IN-PORT',
      example: '7897',
      validator: (value) => portValidator(value)
    }
  ],
  [
    'DSCP',
    {
      name: 'DSCP',
      example: '4'
    }
  ],
  [
    'PROCESS-NAME',
    {
      name: 'PROCESS-NAME',
      example: platform === 'win32' ? 'chrome.exe' : 'curl'
    }
  ],
  [
    'PROCESS-PATH',
    {
      name: 'PROCESS-PATH',
      example:
        platform === 'win32'
          ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
          : '/usr/bin/wget'
    }
  ],
  [
    'PROCESS-NAME-REGEX',
    {
      name: 'PROCESS-NAME-REGEX',
      example: '.*telegram.*'
    }
  ],
  [
    'PROCESS-PATH-REGEX',
    {
      name: 'PROCESS-PATH-REGEX',
      example: platform === 'win32' ? '(?i).*Application\\chrome.*' : '.*bin/wget'
    }
  ],
  [
    'NETWORK',
    {
      name: 'NETWORK',
      example: 'udp',
      validator: (value) => ['tcp', 'udp'].includes(value)
    }
  ],
  [
    'UID',
    {
      name: 'UID',
      example: '1001',
      validator: (value) => (+value ? true : false)
    }
  ],
  [
    'IN-TYPE',
    {
      name: 'IN-TYPE',
      example: 'SOCKS/HTTP'
    }
  ],
  [
    'IN-USER',
    {
      name: 'IN-USER',
      example: 'mihomo'
    }
  ],
  [
    'IN-NAME',
    {
      name: 'IN-NAME',
      example: 'ss'
    }
  ],
  [
    'SUB-RULE',
    {
      name: 'SUB-RULE',
      example: '(NETWORK,tcp)'
    }
  ],
  [
    'RULE-SET',
    {
      name: 'RULE-SET',
      example: 'providername',
      noResolve: true,
      src: true
    }
  ],
  [
    'AND',
    {
      name: 'AND',
      example: '((DOMAIN,baidu.com),(NETWORK,UDP))'
    }
  ],
  [
    'OR',
    {
      name: 'OR',
      example: '((NETWORK,UDP),(DOMAIN,baidu.com))'
    }
  ],
  [
    'NOT',
    {
      name: 'NOT',
      example: '((DOMAIN,baidu.com))'
    }
  ],
  [
    'MATCH',
    {
      name: 'MATCH',
      required: false
    }
  ]
])

const ruleTypes = Array.from(ruleDefinitionsMap.keys())

const isRuleSupportsNoResolve = (ruleType: string): boolean => {
  const rule = ruleDefinitionsMap.get(ruleType)
  return rule?.noResolve === true
}

const isRuleSupportsSrc = (ruleType: string): boolean => {
  const rule = ruleDefinitionsMap.get(ruleType)
  return rule?.src === true
}

const getRuleExample = (ruleType: string): string => {
  const rule = ruleDefinitionsMap.get(ruleType)
  return rule?.example || ''
}

const isAddRuleDisabled = (
  newRule: RuleItem,
  validateRulePayload: (ruleType: string, payload: string) => boolean
): boolean => {
  return (
    !(newRule.payload.trim() || newRule.type === 'MATCH') ||
    !newRule.type ||
    !newRule.proxy ||
    (newRule.type !== 'MATCH' &&
      newRule.payload.trim() !== '' &&
      !validateRulePayload(newRule.type, newRule.payload))
  )
}

// 避免整个列表重新渲染
interface RuleListItemProps {
  rule: RuleItem
  originalIndex: number
  isDeleted: boolean
  isPrependOrAppend: boolean
  rulesLength: number
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
  onRemove: (index: number) => void
}

const RuleListItem = memo<RuleListItemProps>(
  ({
    rule,
    originalIndex,
    isDeleted,
    isPrependOrAppend,
    rulesLength,
    onMoveUp,
    onMoveDown,
    onRemove
  }) => {
    let bgColorClass = 'bg-content2'
    let textStyleClass = ''

    if (isDeleted) {
      bgColorClass = 'bg-danger-50 opacity-70'
      textStyleClass = 'line-through text-foreground-500'
    } else if (isPrependOrAppend) {
      bgColorClass = 'bg-success-50'
    }

    return (
      <div className={`flex items-center gap-2 p-2 rounded-lg ${bgColorClass}`}>
        <div className="flex flex-col">
          <div className="flex items-center gap-1">
            <Chip size="sm" variant="flat">
              {rule.type}
            </Chip>
            {/* 显示附加参数 */}
            <div className="flex gap-1">
              {rule.additionalParams &&
                rule.additionalParams.length > 0 &&
                rule.additionalParams.map((param, idx) => (
                  <Chip key={idx} size="sm" variant="flat" color="secondary">
                    {param}
                  </Chip>
                ))}
            </div>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-medium truncate ${textStyleClass}`}>
            {rule.type === 'MATCH' ? rule.proxy : rule.payload}
          </div>
          {rule.proxy && rule.type !== 'MATCH' && (
            <div className={`text-sm text-foreground-500 truncate ${textStyleClass}`}>
              {rule.proxy}
            </div>
          )}
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="light"
            onPress={() => originalIndex !== -1 && onMoveUp(originalIndex)}
            isIconOnly
            isDisabled={originalIndex === -1 || originalIndex === 0 || isDeleted}
          >
            <IoMdArrowUp className="text-lg" />
          </Button>
          <Button
            size="sm"
            variant="light"
            onPress={() => originalIndex !== -1 && onMoveDown(originalIndex)}
            isIconOnly
            isDisabled={originalIndex === -1 || originalIndex === rulesLength - 1 || isDeleted}
          >
            <IoMdArrowDown className="text-lg" />
          </Button>
          <Button
            size="sm"
            color={originalIndex !== -1 && isDeleted ? 'success' : 'danger'}
            variant="light"
            onPress={() => originalIndex !== -1 && onRemove(originalIndex)}
            isIconOnly
          >
            {originalIndex !== -1 && isDeleted ? (
              <IoMdUndo className="text-lg" />
            ) : (
              <IoMdTrash className="text-lg" />
            )}
          </Button>
        </div>
      </div>
    )
  },
  (prevProps, nextProps) => {
    return (
      prevProps.rule === nextProps.rule &&
      prevProps.originalIndex === nextProps.originalIndex &&
      prevProps.isDeleted === nextProps.isDeleted &&
      prevProps.isPrependOrAppend === nextProps.isPrependOrAppend &&
      prevProps.rulesLength === nextProps.rulesLength
    )
  }
)

const EditRulesModal: React.FC<Props> = (props) => {
  const { id, onClose } = props
  const [rules, setRules] = useState<RuleItem[]>([])
  const [, setProfileContent] = useState('')
  const [newRule, setNewRule] = useState<RuleItem>({
    type: 'DOMAIN',
    payload: '',
    proxy: 'DIRECT',
    additionalParams: []
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [deferredSearchTerm, setDeferredSearchTerm] = useState('')
  const [proxyGroups, setProxyGroups] = useState<string[]>([])
  const [deletedRules, setDeletedRules] = useState<Set<number>>(new Set())
  const [prependRules, setPrependRules] = useState<Set<number>>(new Set())
  const [appendRules, setAppendRules] = useState<Set<number>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const { t } = useTranslation()

  const ruleIndexMap = useMemo(() => {
    const map = new Map<RuleItem, number>()
    rules.forEach((rule, index) => {
      map.set(rule, index)
    })
    return map
  }, [rules])

  const filteredRules = useMemo(() => {
    if (deferredSearchTerm === '') return rules

    const lowerSearch = deferredSearchTerm.toLowerCase()
    return rules.filter(
      (rule) =>
        rule.type.toLowerCase().includes(lowerSearch) ||
        rule.payload.toLowerCase().includes(lowerSearch) ||
        (rule.proxy && rule.proxy.toLowerCase().includes(lowerSearch)) ||
        (rule.additionalParams &&
          rule.additionalParams.some((param) => param.toLowerCase().includes(lowerSearch)))
    )
  }, [deferredSearchTerm, rules])

  useEffect(() => {
    startTransition(() => {
      setDeferredSearchTerm(searchTerm)
    })
  }, [searchTerm])

  const deferredFilteredRules = useDeferredValue(filteredRules)

  const getContent = async (): Promise<void> => {
    setIsLoading(true)
    try {
      const content = await getProfileStr(id)
      setProfileContent(content)

      const parsed = yaml.load(content) as any
      let initialRules: RuleItem[] = []

      if (parsed && parsed.rules && Array.isArray(parsed.rules)) {
        initialRules = parsed.rules.map((rule: string) => {
          const parts = rule.split(',')
          if (parts[0] === 'MATCH') {
            return {
              type: 'MATCH',
              payload: '',
              proxy: parts[1]
            }
          } else {
            const additionalParams = parts.slice(3).filter((param) => param.trim() !== '') || []
            return {
              type: parts[0],
              payload: parts[1],
              proxy: parts[2],
              additionalParams
            }
          }
        })
      }

      // 提取代理组
      if (parsed) {
        const groups: string[] = []

        // 添加代理组和代理名称
        if (Array.isArray(parsed['proxy-groups'])) {
          groups.push(...parsed['proxy-groups'].map((group: any) => group?.name).filter(Boolean))
        }

        if (Array.isArray(parsed['proxies'])) {
          groups.push(...parsed['proxies'].map((proxy: any) => proxy?.name).filter(Boolean))
        }

        // 预置出站 https://wiki.metacubex.one/config/proxies/built-in/
        groups.push('DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE')

        // 去重
        setProxyGroups([...new Set(groups)])
      }

      // 读取规则文件
      try {
        const ruleContent = await getRuleStr(id)
        const ruleData = yaml.load(ruleContent) as {
          prepend?: string[]
          append?: string[]
          delete?: string[]
        }

        if (ruleData) {
          let allRules = [...initialRules]
          const newPrependRules = new Set<number>()
          const newAppendRules = new Set<number>()
          const newDeletedRules = new Set<number>()

          // 处理前置规则
          if (ruleData.prepend && Array.isArray(ruleData.prepend)) {
            const prependRules: RuleItem[] = []
            ruleData.prepend.forEach((ruleStr: string) => {
              prependRules.push(parseRuleString(ruleStr))
            })

            // 插入前置规则
            const { updatedRules, ruleIndices } = processRulesWithPositions(
              prependRules,
              allRules,
              (rule, currentRules) => {
                if (rule.offset !== undefined && rule.offset < currentRules.length) {
                  return rule.offset
                }
                return 0
              }
            )

            allRules = updatedRules
            ruleIndices.forEach((index) => newPrependRules.add(index))
          }

          // 处理后置规则
          if (ruleData.append && Array.isArray(ruleData.append)) {
            const appendRules: RuleItem[] = []
            ruleData.append.forEach((ruleStr: string) => {
              appendRules.push(parseRuleString(ruleStr))
            })

            // 插入后置规则
            const { updatedRules, ruleIndices } = processAppendRulesWithPositions(
              appendRules,
              allRules,
              (rule, currentRules) => {
                if (rule.offset !== undefined) {
                  return Math.max(0, currentRules.length - rule.offset)
                }
                return currentRules.length
              }
            )

            allRules = updatedRules

            // 标记后置规则
            ruleIndices.forEach((index) => newAppendRules.add(index))
          }

          // 处理删除规则
          if (ruleData.delete && Array.isArray(ruleData.delete)) {
            const deleteRules = ruleData.delete.map((ruleStr: string) => {
              return parseRuleString(ruleStr)
            })

            // 匹配并标记删除规则
            deleteRules.forEach((deleteRule) => {
              const matchedIndex = allRules.findIndex(
                (rule) =>
                  rule.type === deleteRule.type &&
                  rule.payload === deleteRule.payload &&
                  rule.proxy === deleteRule.proxy &&
                  JSON.stringify(rule.additionalParams || []) ===
                    JSON.stringify(deleteRule.additionalParams || [])
              )

              if (matchedIndex !== -1) {
                newDeletedRules.add(matchedIndex)
              }
            })
          }

          // 更新状态
          setPrependRules(newPrependRules)
          setAppendRules(newAppendRules)
          setDeletedRules(newDeletedRules)

          // 设置规则列表
          setRules(allRules)
        } else {
          // 使用初始规则
          setRules(initialRules)
          // 清空规则标记
          setPrependRules(new Set())
          setAppendRules(new Set())
          setDeletedRules(new Set())
        }
      } catch (ruleError) {
        // 规则文件读取失败
        console.debug('规则文件读取失败:', ruleError)
        setRules(initialRules)
        // 清空规则标记
        setPrependRules(new Set())
        setAppendRules(new Set())
        setDeletedRules(new Set())
      }
    } catch (e) {
      console.error('Failed to parse profile content', e)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    getContent()
  }, [])

  const validateRulePayload = useCallback((ruleType: string, payload: string): boolean => {
    if (ruleType === 'MATCH') {
      return true
    }

    const rule = ruleDefinitionsMap.get(ruleType)
    const validator = rule?.validator
    if (!validator) {
      return true
    }

    return validator(payload)
  }, [])

  const isPayloadValid = useMemo(() => {
    if (newRule.type === 'MATCH' || !newRule.payload) {
      return true
    }
    return validateRulePayload(newRule.type, newRule.payload)
  }, [newRule.type, newRule.payload, validateRulePayload])

  const handleSave = useCallback(async (): Promise<void> => {
    try {
      // 保存规则到文件
      const prependRuleStrings = Array.from(prependRules)
        .filter((index) => !deletedRules.has(index) && index < rules.length)
        .map((index) => convertRuleToString(rules[index]))

      const appendRuleStrings = Array.from(appendRules)
        .filter((index) => !deletedRules.has(index) && index < rules.length)
        .map((index) => convertRuleToString(rules[index]))

      // 保存删除的规则
      const deletedRuleStrings = Array.from(deletedRules)
        .filter(
          (index) => index < rules.length && !prependRules.has(index) && !appendRules.has(index)
        )
        .map((index) => {
          const rule = rules[index]
          const parts = [rule.type]
          if (rule.payload) parts.push(rule.payload)
          if (rule.proxy) parts.push(rule.proxy)
          if (rule.additionalParams && rule.additionalParams.length > 0) {
            parts.push(...rule.additionalParams)
          }
          return parts.join(',')
        })

      // 创建规则数据对象
      const ruleData = {
        prepend: prependRuleStrings,
        append: appendRuleStrings,
        delete: deletedRuleStrings
      }

      // 保存到 YAML 文件
      const ruleYaml = yaml.dump(ruleData)
      await setRuleStr(id, ruleYaml)
      onClose()
    } catch (e) {
      toast.error(
        t('profiles.editRules.saveError') + ': ' + (e instanceof Error ? e.message : String(e))
      )
    }
  }, [prependRules, deletedRules, rules, appendRules, id, onClose, t])

  const handleRuleTypeChange = (selected: string): void => {
    const noResolveSupported = isRuleSupportsNoResolve(selected)
    const srcSupported = isRuleSupportsSrc(selected)

    let additionalParams = [...(newRule.additionalParams || [])]
    if (!noResolveSupported) {
      additionalParams = additionalParams.filter((param) => param !== 'no-resolve')
    }
    if (!srcSupported) {
      additionalParams = additionalParams.filter((param) => param !== 'src')
    }

    setNewRule({
      ...newRule,
      type: selected,
      additionalParams: additionalParams.length > 0 ? additionalParams : []
    })
  }

  const handleAdditionalParamChange = (param: string, checked: boolean): void => {
    let newAdditionalParams = [...(newRule.additionalParams || [])]

    if (checked) {
      if (!newAdditionalParams.includes(param)) {
        newAdditionalParams.push(param)
      }
    } else {
      newAdditionalParams = newAdditionalParams.filter((p) => p !== param)
    }

    setNewRule({
      ...newRule,
      additionalParams: newAdditionalParams
    })
  }

  const handleAddRule = useCallback(
    (position: 'prepend' | 'append' = 'append'): void => {
      if (!(newRule.type === 'MATCH' || newRule.payload.trim() !== '')) {
        return
      }

      if (
        newRule.type !== 'MATCH' &&
        newRule.payload.trim() !== '' &&
        !validateRulePayload(newRule.type, newRule.payload)
      ) {
        toast.error(t('profiles.editRules.invalidPayload') + ': ' + getRuleExample(newRule.type))
        return
      }

      const newRuleItem = { ...newRule }

      startTransition(() => {
        let updatedRules: RuleItem[]

        if (position === 'prepend') {
          // 前置规则插入
          const insertPosition =
            newRuleItem.offset !== undefined ? Math.min(newRuleItem.offset, rules.length) : 0

          updatedRules = [...rules]
          updatedRules.splice(insertPosition, 0, newRuleItem)

          // 更新规则索引
          const { newPrependRules, newAppendRules, newDeletedRules } =
            updateAllRuleIndicesAfterInsertion(
              prependRules,
              appendRules,
              deletedRules,
              insertPosition,
              true
            )

          // 批量更新状态
          setPrependRules(newPrependRules)
          setAppendRules(newAppendRules)
          setDeletedRules(newDeletedRules)
        } else {
          // 后置规则插入
          const insertPosition =
            newRuleItem.offset !== undefined
              ? Math.max(0, rules.length - newRuleItem.offset)
              : rules.length

          updatedRules = [...rules]
          updatedRules.splice(insertPosition, 0, newRuleItem)

          // 更新规则索引
          const { newPrependRules, newAppendRules, newDeletedRules } =
            updateAllRuleIndicesAfterInsertion(
              prependRules,
              appendRules,
              deletedRules,
              insertPosition,
              false,
              true
            )

          // 批量更新状态
          setPrependRules(newPrependRules)
          setAppendRules(newAppendRules)
          setDeletedRules(newDeletedRules)
        }

        // 更新规则列表
        setRules(updatedRules)
      })
      setNewRule({ type: 'DOMAIN', payload: '', proxy: 'DIRECT', additionalParams: [] })
    },
    [newRule, rules, prependRules, appendRules, deletedRules, validateRulePayload, t]
  )

  const handleRemoveRule = useCallback((index: number): void => {
    setDeletedRules((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(index)) {
        newSet.delete(index) // 如果已经标记为删除，则取消标记
      } else {
        newSet.add(index) // 标记为删除
      }
      return newSet
    })
  }, [])

  const handleMoveRuleUp = useCallback(
    (index: number): void => {
      if (index <= 0) return
      startTransition(() => {
        const updatedRules = [...rules]
        const temp = updatedRules[index]
        updatedRules[index] = updatedRules[index - 1]
        updatedRules[index - 1] = temp

        // 更新前置规则偏移量
        if (prependRules.has(index)) {
          updatedRules[index - 1] = {
            ...updatedRules[index - 1],
            offset: Math.max(0, (updatedRules[index - 1].offset || 0) - 1)
          }
        }

        // 更新后置规则偏移量
        if (appendRules.has(index)) {
          updatedRules[index - 1] = {
            ...updatedRules[index - 1],
            offset: (updatedRules[index - 1].offset || 0) + 1
          }
        }

        // 批量更新状态
        setRules(updatedRules)
        setDeletedRules((prev) => updateRuleIndices(prev, index, index - 1))
        setPrependRules((prev) => updateRuleIndices(prev, index, index - 1))
        setAppendRules((prev) => updateRuleIndices(prev, index, index - 1))
      })
    },
    [rules, prependRules, appendRules]
  )

  const handleMoveRuleDown = useCallback(
    (index: number): void => {
      if (index >= rules.length - 1) return
      startTransition(() => {
        const updatedRules = [...rules]
        const temp = updatedRules[index]
        updatedRules[index] = updatedRules[index + 1]
        updatedRules[index + 1] = temp

        // 更新前置规则偏移量
        if (prependRules.has(index)) {
          updatedRules[index + 1] = {
            ...updatedRules[index + 1],
            offset: (updatedRules[index + 1].offset || 0) + 1
          }
        }

        // 更新后置规则偏移量
        if (appendRules.has(index)) {
          updatedRules[index + 1] = {
            ...updatedRules[index + 1],
            offset: Math.max(0, (updatedRules[index + 1].offset || 0) - 1)
          }
        }

        // 批量更新状态
        setRules(updatedRules)
        setDeletedRules((prev) => updateRuleIndices(prev, index, index + 1))
        setPrependRules((prev) => updateRuleIndices(prev, index, index + 1))
        setAppendRules((prev) => updateRuleIndices(prev, index, index + 1))
      })
    },
    [rules, prependRules, appendRules]
  )

  // 解析规则字符串
  const parseRuleString = (ruleStr: string): RuleItem => {
    const parts = ruleStr.split(',')
    const firstPartIsNumber =
      !isNaN(Number(parts[0])) && parts[0].trim() !== '' && parts.length >= 3

    let offset = 0
    let ruleParts = parts

    if (firstPartIsNumber) {
      offset = parseInt(parts[0])
      ruleParts = parts.slice(1)
    }

    if (ruleParts[0] === 'MATCH') {
      return {
        type: 'MATCH',
        payload: '',
        proxy: ruleParts[1],
        offset: offset > 0 ? offset : undefined
      }
    } else {
      const additionalParams = ruleParts.slice(3).filter((param) => param.trim() !== '') || []
      return {
        type: ruleParts[0],
        payload: ruleParts[1],
        proxy: ruleParts[2],
        additionalParams,
        offset: offset > 0 ? offset : undefined
      }
    }
  }

  // 规则转字符串
  const convertRuleToString = (rule: RuleItem): string => {
    const parts = [rule.type]
    if (rule.payload) parts.push(rule.payload)
    if (rule.proxy) parts.push(rule.proxy)
    if (rule.additionalParams && rule.additionalParams.length > 0) {
      parts.push(...rule.additionalParams)
    }

    // 添加偏移量
    if (rule.offset !== undefined && rule.offset > 0) {
      parts.unshift(rule.offset.toString())
    }

    return parts.join(',')
  }

  // 处理前置规则位置
  const processRulesWithPositions = (
    rules: RuleItem[],
    allRules: RuleItem[],
    positionCalculator: (rule: RuleItem, currentRules: RuleItem[]) => number
  ): { updatedRules: RuleItem[]; ruleIndices: Set<number> } => {
    const updatedRules = [...allRules]
    const ruleIndices = new Set<number>()

    // 按顺序处理规则
    rules.forEach((rule) => {
      const targetPosition = positionCalculator(rule, updatedRules)
      const actualPosition = Math.min(targetPosition, updatedRules.length)
      updatedRules.splice(actualPosition, 0, rule)

      // 更新索引
      const newRuleIndices = new Set<number>()
      ruleIndices.forEach((idx) => {
        if (idx >= actualPosition) {
          newRuleIndices.add(idx + 1)
        } else {
          newRuleIndices.add(idx)
        }
      })
      // 添加当前规则索引
      newRuleIndices.add(actualPosition)

      // 更新索引集合
      ruleIndices.clear()
      newRuleIndices.forEach((idx) => ruleIndices.add(idx))
    })

    return { updatedRules, ruleIndices }
  }

  // 处理后置规则位置
  const processAppendRulesWithPositions = (
    rules: RuleItem[],
    allRules: RuleItem[],
    positionCalculator: (rule: RuleItem, currentRules: RuleItem[]) => number
  ): { updatedRules: RuleItem[]; ruleIndices: Set<number> } => {
    const updatedRules = [...allRules]
    const ruleIndices = new Set<number>()

    // 按顺序处理规则
    rules.forEach((rule) => {
      const targetPosition = positionCalculator(rule, updatedRules)
      const actualPosition = Math.min(targetPosition, updatedRules.length)
      updatedRules.splice(actualPosition, 0, rule)

      // 更新索引
      const newRuleIndices = new Set<number>()
      ruleIndices.forEach((idx) => {
        if (idx >= actualPosition) {
          newRuleIndices.add(idx + 1)
        } else {
          newRuleIndices.add(idx)
        }
      })
      // 添加当前规则索引
      newRuleIndices.add(actualPosition)

      // 更新索引集合
      ruleIndices.clear()
      newRuleIndices.forEach((idx) => ruleIndices.add(idx))
    })

    return { updatedRules, ruleIndices }
  }

  // 更新规则索引
  const updateRuleIndices = (prev: Set<number>, index1: number, index2: number): Set<number> => {
    const newSet = new Set<number>()
    prev.forEach((idx) => {
      if (idx === index1) {
        newSet.add(index2)
      } else if (idx === index2) {
        newSet.add(index1)
      } else {
        newSet.add(idx)
      }
    })
    return newSet
  }

  // 计算插入位置的索引
  const getUpdatedIndexForInsertion = (index: number, insertPosition: number): number => {
    if (index >= insertPosition) {
      return index + 1
    } else {
      return index
    }
  }

  // 插入规则后更新所有索引
  const updateAllRuleIndicesAfterInsertion = (
    prependRules: Set<number>,
    appendRules: Set<number>,
    deletedRules: Set<number>,
    insertPosition: number,
    isNewPrependRule: boolean = false,
    isNewAppendRule: boolean = false
  ): {
    newPrependRules: Set<number>
    newAppendRules: Set<number>
    newDeletedRules: Set<number>
  } => {
    const newPrependRules = new Set<number>()
    const newAppendRules = new Set<number>()
    const newDeletedRules = new Set<number>()

    // 更新前置规则索引
    prependRules.forEach((idx) => {
      newPrependRules.add(getUpdatedIndexForInsertion(idx, insertPosition))
    })

    // 更新后置规则索引
    appendRules.forEach((idx) => {
      newAppendRules.add(getUpdatedIndexForInsertion(idx, insertPosition))
    })

    // 更新删除规则索引
    deletedRules.forEach((idx) => {
      newDeletedRules.add(getUpdatedIndexForInsertion(idx, insertPosition))
    })

    // 标记新规则
    if (isNewPrependRule) {
      newPrependRules.add(insertPosition)
    }

    if (isNewAppendRule) {
      newAppendRules.add(insertPosition)
    }

    return { newPrependRules, newAppendRules, newDeletedRules }
  }

  return (
    <Modal
      backdrop="blur"
      classNames={{ backdrop: 'top-[48px]' }}
      size="5xl"
      hideCloseButton
      isOpen={true}
      onOpenChange={onClose}
      scrollBehavior="inside"
    >
      <ModalContent className="h-full w-[calc(100%-100px)]">
        <ModalHeader className="flex pb-0 app-drag">
          <div className="flex justify-start">
            <div className="flex items-center">{t('profiles.editRules.title')}</div>
          </div>
        </ModalHeader>
        <ModalBody className="h-full">
          <div className="flex gap-4 h-full">
            {/* 左侧面板 - 规则表单 */}
            <div className="w-1/3 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Select
                  label={t('profiles.editRules.ruleType')}
                  selectedKeys={[newRule.type]}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0] as string
                    handleRuleTypeChange(selected)
                  }}
                >
                  {ruleTypes.map((type) => (
                    <SelectItem key={type}>{type}</SelectItem>
                  ))}
                </Select>

                <Input
                  label={t('profiles.editRules.payload')}
                  placeholder={
                    getRuleExample(newRule.type) || t('profiles.editRules.payloadPlaceholder')
                  }
                  value={newRule.payload}
                  onValueChange={(value) => setNewRule({ ...newRule, payload: value })}
                  isDisabled={newRule.type === 'MATCH'}
                  color={
                    newRule.payload && newRule.type !== 'MATCH' && !isPayloadValid
                      ? 'danger'
                      : 'default'
                  }
                />

                <Autocomplete
                  label={t('profiles.editRules.proxy')}
                  placeholder={t('profiles.editRules.proxyPlaceholder')}
                  selectedKey={newRule.proxy}
                  onSelectionChange={(key) => setNewRule({ ...newRule, proxy: key as string })}
                  inputValue={newRule.proxy}
                  onInputChange={(value) => setNewRule({ ...newRule, proxy: value })}
                >
                  {proxyGroups.map((group) => (
                    <AutocompleteItem key={group} textValue={group}>
                      {group}
                    </AutocompleteItem>
                  ))}
                </Autocomplete>

                {/* 附加参数 */}
                {(isRuleSupportsNoResolve(newRule.type) || isRuleSupportsSrc(newRule.type)) && (
                  <>
                    <Divider className="my-2" />
                    <div className="flex flex-col gap-2">
                      {isRuleSupportsNoResolve(newRule.type) && (
                        <Checkbox
                          isSelected={newRule.additionalParams?.includes('no-resolve') || false}
                          onValueChange={(checked) =>
                            handleAdditionalParamChange('no-resolve', checked)
                          }
                        >
                          {t('profiles.editRules.noResolve')}
                        </Checkbox>
                      )}
                      {isRuleSupportsSrc(newRule.type) && (
                        <Checkbox
                          isSelected={newRule.additionalParams?.includes('src') || false}
                          onValueChange={(checked) => handleAdditionalParamChange('src', checked)}
                        >
                          {t('profiles.editRules.src')}
                        </Checkbox>
                      )}
                    </div>
                  </>
                )}

                <div className="flex flex-col gap-2">
                  <Button
                    color="primary"
                    onPress={() => handleAddRule('prepend')}
                    isDisabled={isAddRuleDisabled(newRule, validateRulePayload)}
                    startContent={<MdVerticalAlignTop className="text-lg" />}
                  >
                    {t('profiles.editRules.addRulePrepend')}
                  </Button>
                  <Button
                    color="primary"
                    variant="bordered"
                    onPress={() => handleAddRule('append')}
                    isDisabled={isAddRuleDisabled(newRule, validateRulePayload)}
                    startContent={<MdVerticalAlignBottom className="text-lg" />}
                  >
                    {t('profiles.editRules.addRuleAppend')}
                  </Button>
                </div>
              </div>

              <div className="flex-1 border-t border-divider pt-4">
                <h3 className="text-lg font-semibold mb-2">
                  {t('profiles.editRules.instructions')}
                </h3>
                <div className="text-sm text-foreground-500">
                  <p className="mb-2">{t('profiles.editRules.instructions1')}</p>
                  <p className="mb-2">{t('profiles.editRules.instructions2')}</p>
                  <p>{t('profiles.editRules.instructions3')}</p>
                </div>
              </div>
            </div>

            {/* 右侧面板 - 规则列表 */}
            <div className="w-2/3 border-l border-divider pl-4 flex flex-col">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold">{t('profiles.editRules.currentRules')}</h3>
                <Input
                  size="sm"
                  placeholder={t('profiles.editRules.searchPlaceholder')}
                  className="w-1/3"
                  value={searchTerm}
                  onValueChange={setSearchTerm}
                />
              </div>
              <div className="flex flex-col gap-2 max-h-[calc(100vh-200px)] overflow-y-auto flex-1">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full py-8">
                    <Spinner size="lg" label={t('common.loading') || 'Loading...'} />
                  </div>
                ) : filteredRules.length === 0 ? (
                  <div className="text-center text-foreground-500 py-4">
                    {rules.length === 0
                      ? t('profiles.editRules.noRules')
                      : searchTerm
                        ? t('profiles.editRules.noMatchingRules')
                        : t('profiles.editRules.noRules')}
                  </div>
                ) : (
                  deferredFilteredRules.map((rule, index) => {
                    const originalIndex = ruleIndexMap.get(rule) ?? -1
                    const isDeleted = deletedRules.has(originalIndex)
                    const isPrependOrAppend =
                      prependRules.has(originalIndex) || appendRules.has(originalIndex)

                    return (
                      <RuleListItem
                        key={`${originalIndex}-${index}`}
                        rule={rule}
                        originalIndex={originalIndex}
                        isDeleted={isDeleted}
                        isPrependOrAppend={isPrependOrAppend}
                        rulesLength={rules.length}
                        onMoveUp={handleMoveRuleUp}
                        onMoveDown={handleMoveRuleDown}
                        onRemove={handleRemoveRule}
                      />
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </ModalBody>
        <ModalFooter className="pt-0">
          <Button
            size="sm"
            variant="light"
            onPress={() => {
              setDeletedRules(new Set()) // 清除删除状态
              onClose()
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button size="sm" color="primary" onPress={handleSave}>
            {t('common.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditRulesModal
