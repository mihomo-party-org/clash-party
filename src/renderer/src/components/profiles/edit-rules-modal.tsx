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
import { Virtuoso } from 'react-virtuoso'
import { IoMdTrash, IoMdArrowUp, IoMdArrowDown, IoMdUndo } from 'react-icons/io'
import { MdVerticalAlignTop, MdVerticalAlignBottom } from 'react-icons/md'
import { platform } from '@renderer/utils/init'
import { toast } from '@renderer/components/base/toast'
import {
  domainValidator,
  domainSuffixValidator,
  domainKeywordValidator,
  domainRegexValidator,
  domainWildcardValidator,
  geositeValidator,
  geoipValidator,
  asnValidator,
  uidValidator,
  dscpValidator,
  networkValidator,
  processPathValidator,
  processPathWildcardValidator,
  processPathRegexValidator,
  processNameValidator,
  processNameWildcardValidator,
  processNameRegexValidator,
  inTypeValidator,
  inUserValidator,
  inNameValidator,
  ruleSetValidator,
  logicRuleValidator,
  subRuleValidator,
  portRangeValidator,
  ipCIDRValidator
} from '@renderer/utils/validate'

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
    'DOMAIN-WILDCARD',
    {
      name: 'DOMAIN-WILDCARD',
      example: '*.google.com',
      validator: (value) => domainWildcardValidator(value)
    }
  ],
  [
    'GEOSITE',
    {
      name: 'GEOSITE',
      example: 'youtube',
      validator: (value) => geositeValidator(value)
    }
  ],
  [
    'GEOIP',
    {
      name: 'GEOIP',
      example: 'CN',
      noResolve: true,
      src: true,
      validator: (value) => geoipValidator(value)
    }
  ],
  [
    'SRC-GEOIP',
    {
      name: 'SRC-GEOIP',
      example: 'CN',
      validator: (value) => geoipValidator(value)
    }
  ],
  [
    'IP-ASN',
    {
      name: 'IP-ASN',
      example: '13335',
      noResolve: true,
      src: true,
      validator: (value) => asnValidator(value)
    }
  ],
  [
    'SRC-IP-ASN',
    {
      name: 'SRC-IP-ASN',
      example: '9808',
      validator: (value) => asnValidator(value)
    }
  ],
  [
    'IP-CIDR',
    {
      name: 'IP-CIDR',
      example: '127.0.0.0/8',
      noResolve: true,
      src: true,
      validator: (value) => ipCIDRValidator(value)
    }
  ],
  [
    'IP-CIDR6',
    {
      name: 'IP-CIDR6',
      example: '2620:0:2d0:200::7/32',
      noResolve: true,
      src: true,
      validator: (value) => ipCIDRValidator(value)
    }
  ],
  [
    'SRC-IP-CIDR',
    {
      name: 'SRC-IP-CIDR',
      example: '192.168.1.201/32',
      validator: (value) => ipCIDRValidator(value)
    }
  ],
  [
    'IP-SUFFIX',
    {
      name: 'IP-SUFFIX',
      example: '8.8.8.8/24',
      noResolve: true,
      src: true,
      validator: (value) => ipCIDRValidator(value)
    }
  ],
  [
    'SRC-IP-SUFFIX',
    {
      name: 'SRC-IP-SUFFIX',
      example: '192.168.1.201/8',
      validator: (value) => ipCIDRValidator(value)
    }
  ],
  [
    'SRC-PORT',
    {
      name: 'SRC-PORT',
      example: '7777',
      validator: (value) => portRangeValidator(value)
    }
  ],
  [
    'DST-PORT',
    {
      name: 'DST-PORT',
      example: '80',
      validator: (value) => portRangeValidator(value)
    }
  ],
  [
    'IN-PORT',
    {
      name: 'IN-PORT',
      example: '7897',
      validator: (value) => portRangeValidator(value)
    }
  ],
  [
    'DSCP',
    {
      name: 'DSCP',
      example: '4',
      validator: (value) => dscpValidator(value)
    }
  ],
  [
    'PROCESS-NAME',
    {
      name: 'PROCESS-NAME',
      example: platform === 'win32' ? 'chrome.exe' : 'curl',
      validator: (value) => processNameValidator(value)
    }
  ],
  [
    'PROCESS-PATH',
    {
      name: 'PROCESS-PATH',
      example:
        platform === 'win32'
          ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
          : '/usr/bin/wget',
      validator: (value) => processPathValidator(value)
    }
  ],
  [
    'PROCESS-NAME-WILDCARD',
    {
      name: 'PROCESS-NAME-WILDCARD',
      example: '*telegram*',
      validator: (value) => processNameWildcardValidator(value)
    }
  ],
  [
    'PROCESS-NAME-REGEX',
    {
      name: 'PROCESS-NAME-REGEX',
      example: '.*telegram.*',
      validator: (value) => processNameRegexValidator(value)
    }
  ],
  [
    'PROCESS-PATH-WILDCARD',
    {
      name: 'PROCESS-PATH-WILDCARD',
      example: platform === 'win32' ? '*\\chrome.exe' : '/usr/*/wget',
      validator: (value) => processPathWildcardValidator(value)
    }
  ],
  [
    'PROCESS-PATH-REGEX',
    {
      name: 'PROCESS-PATH-REGEX',
      example: platform === 'win32' ? '(?i).*Application\\\\chrome.*' : '.*bin/wget',
      validator: (value) => processPathRegexValidator(value)
    }
  ],
  [
    'NETWORK',
    {
      name: 'NETWORK',
      example: 'udp',
      validator: (value) => networkValidator(value)
    }
  ],
  [
    'UID',
    {
      name: 'UID',
      example: '1001',
      validator: (value) => uidValidator(value)
    }
  ],
  [
    'IN-TYPE',
    {
      name: 'IN-TYPE',
      example: 'SOCKS/HTTP',
      validator: (value) => inTypeValidator(value)
    }
  ],
  [
    'IN-USER',
    {
      name: 'IN-USER',
      example: 'mihomo',
      validator: (value) => inUserValidator(value)
    }
  ],
  [
    'IN-NAME',
    {
      name: 'IN-NAME',
      example: 'ss',
      validator: (value) => inNameValidator(value)
    }
  ],
  [
    'SUB-RULE',
    {
      name: 'SUB-RULE',
      example: '(NETWORK,tcp)',
      validator: (value) => subRuleValidator(value)
    }
  ],
  [
    'RULE-SET',
    {
      name: 'RULE-SET',
      example: 'providername',
      noResolve: true,
      src: true,
      validator: (value) => ruleSetValidator(value)
    }
  ],
  [
    'AND',
    {
      name: 'AND',
      example: '((DOMAIN,baidu.com),(NETWORK,UDP))',
      validator: (value) => logicRuleValidator(value)
    }
  ],
  [
    'OR',
    {
      name: 'OR',
      example: '((NETWORK,UDP),(DOMAIN,baidu.com))',
      validator: (value) => logicRuleValidator(value)
    }
  ],
  [
    'NOT',
    {
      name: 'NOT',
      example: '((DOMAIN,baidu.com))',
      validator: (value) => logicRuleValidator(value)
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

const RuleListItemBase: React.FC<RuleListItemProps> = ({
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
}

const RuleListItem = memo(RuleListItemBase, (prevProps, nextProps) => {
  return (
    prevProps.rule === nextProps.rule &&
    prevProps.originalIndex === nextProps.originalIndex &&
    prevProps.isDeleted === nextProps.isDeleted &&
    prevProps.isPrependOrAppend === nextProps.isPrependOrAppend &&
    prevProps.rulesLength === nextProps.rulesLength
  )
})

RuleListItem.displayName = 'RuleListItem'

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

  // 解析规则字符串
  const parseRuleString = useCallback((ruleStr: string): RuleItem => {
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
  }, [])

  // 处理前置规则位置
  const processRulesWithPositions = useCallback(
    (
      rulesToProcess: RuleItem[],
      allRules: RuleItem[],
      positionCalculator: (rule: RuleItem, currentRules: RuleItem[]) => number
    ): { updatedRules: RuleItem[]; ruleIndices: Set<number> } => {
      const updatedRules = [...allRules]
      const ruleIndices = new Set<number>()

      rulesToProcess.forEach((rule) => {
        const targetPosition = positionCalculator(rule, updatedRules)
        const actualPosition = Math.min(targetPosition, updatedRules.length)
        updatedRules.splice(actualPosition, 0, rule)

        const newRuleIndices = new Set<number>()
        ruleIndices.forEach((idx) => {
          if (idx >= actualPosition) {
            newRuleIndices.add(idx + 1)
          } else {
            newRuleIndices.add(idx)
          }
        })
        newRuleIndices.add(actualPosition)

        ruleIndices.clear()
        newRuleIndices.forEach((idx) => ruleIndices.add(idx))
      })

      return { updatedRules, ruleIndices }
    },
    []
  )

  // 处理后置规则位置
  const processAppendRulesWithPositions = useCallback(
    (
      rulesToProcess: RuleItem[],
      allRules: RuleItem[],
      positionCalculator: (rule: RuleItem, currentRules: RuleItem[]) => number
    ): { updatedRules: RuleItem[]; ruleIndices: Set<number> } => {
      const updatedRules = [...allRules]
      const ruleIndices = new Set<number>()

      rulesToProcess.forEach((rule) => {
        const targetPosition = positionCalculator(rule, updatedRules)
        const actualPosition = Math.min(targetPosition, updatedRules.length)
        updatedRules.splice(actualPosition, 0, rule)

        const newRuleIndices = new Set<number>()
        ruleIndices.forEach((idx) => {
          if (idx >= actualPosition) {
            newRuleIndices.add(idx + 1)
          } else {
            newRuleIndices.add(idx)
          }
        })
        newRuleIndices.add(actualPosition)

        ruleIndices.clear()
        newRuleIndices.forEach((idx) => ruleIndices.add(idx))
      })

      return { updatedRules, ruleIndices }
    },
    []
  )

  useEffect(() => {
    const loadContent = async (): Promise<void> => {
      setIsLoading(true)
      try {
        const content = await getProfileStr(id)
        setProfileContent(content)

        const parsed = yaml.load(content) as Record<string, unknown> | undefined
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

        if (parsed) {
          const groups: string[] = []

          if (Array.isArray(parsed['proxy-groups'])) {
            groups.push(
              ...((parsed['proxy-groups'] as Array<Record<string, unknown>>)
                .map((group) =>
                  group && typeof group['name'] === 'string' ? (group['name'] as string) : ''
                )
                .filter(Boolean) as string[])
            )
          }

          if (Array.isArray(parsed['proxies'])) {
            groups.push(
              ...((parsed['proxies'] as Array<Record<string, unknown>>)
                .map((proxy) =>
                  proxy && typeof proxy['name'] === 'string' ? (proxy['name'] as string) : ''
                )
                .filter(Boolean) as string[])
            )
          }

          groups.push('DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE')
          setProxyGroups([...new Set(groups)])
        }

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

            if (ruleData.prepend && Array.isArray(ruleData.prepend)) {
              const prependRuleItems: RuleItem[] = []
              ruleData.prepend.forEach((ruleStr: string) => {
                prependRuleItems.push(parseRuleString(ruleStr))
              })

              const { updatedRules, ruleIndices } = processRulesWithPositions(
                prependRuleItems,
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

            if (ruleData.append && Array.isArray(ruleData.append)) {
              const appendRuleItems: RuleItem[] = []
              ruleData.append.forEach((ruleStr: string) => {
                appendRuleItems.push(parseRuleString(ruleStr))
              })

              const { updatedRules, ruleIndices } = processAppendRulesWithPositions(
                appendRuleItems,
                allRules,
                (rule, currentRules) => {
                  if (rule.offset !== undefined) {
                    return Math.max(0, currentRules.length - rule.offset)
                  }
                  return currentRules.length
                }
              )

              allRules = updatedRules
              ruleIndices.forEach((index) => newAppendRules.add(index))
            }

            if (ruleData.delete && Array.isArray(ruleData.delete)) {
              const deleteRules = ruleData.delete.map((ruleStr: string) => {
                return parseRuleString(ruleStr)
              })

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

            setPrependRules(newPrependRules)
            setAppendRules(newAppendRules)
            setDeletedRules(newDeletedRules)
            setRules(allRules)
          } else {
            setRules(initialRules)
            setPrependRules(new Set())
            setAppendRules(new Set())
            setDeletedRules(new Set())
          }
        } catch {
          setRules(initialRules)
          setPrependRules(new Set())
          setAppendRules(new Set())
          setDeletedRules(new Set())
        }
      } catch {
        // 解析配置文件失败，静默处理
      } finally {
        setIsLoading(false)
      }
    }
    loadContent()
  }, [id, parseRuleString, processRulesWithPositions, processAppendRulesWithPositions])

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

  // 计算插入位置的索引
  const getUpdatedIndexForInsertion = (index: number, insertPosition: number): number => {
    if (index >= insertPosition) {
      return index + 1
    } else {
      return index
    }
  }

  // 插入规则后更新所有索引
  const updateAllRuleIndicesAfterInsertion = useCallback(
    (
      currentPrependRules: Set<number>,
      currentAppendRules: Set<number>,
      currentDeletedRules: Set<number>,
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

      currentPrependRules.forEach((idx) => {
        newPrependRules.add(getUpdatedIndexForInsertion(idx, insertPosition))
      })

      currentAppendRules.forEach((idx) => {
        newAppendRules.add(getUpdatedIndexForInsertion(idx, insertPosition))
      })

      currentDeletedRules.forEach((idx) => {
        newDeletedRules.add(getUpdatedIndexForInsertion(idx, insertPosition))
      })

      if (isNewPrependRule) {
        newPrependRules.add(insertPosition)
      }

      if (isNewAppendRule) {
        newAppendRules.add(insertPosition)
      }

      return { newPrependRules, newAppendRules, newDeletedRules }
    },
    []
  )

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
    [
      newRule,
      rules,
      prependRules,
      appendRules,
      deletedRules,
      validateRulePayload,
      t,
      updateAllRuleIndicesAfterInsertion
    ]
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

  // 规则转字符串
  const convertRuleToString = (rule: RuleItem): string => {
    const parts = [rule.type]
    if (rule.payload) parts.push(rule.payload)
    if (rule.proxy) parts.push(rule.proxy)
    if (rule.additionalParams && rule.additionalParams.length > 0) {
      parts.push(...rule.additionalParams)
    }

    if (rule.offset !== undefined && rule.offset > 0) {
      parts.unshift(rule.offset.toString())
    }

    return parts.join(',')
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
                    className={`${newRule.payload && newRule.type !== 'MATCH' && !isPayloadValid ? 'border-red-500 ring-1 ring-red-500 rounded-lg' : ''}`}
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
              <div className="flex-1 min-h-0">
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
                  <Virtuoso
                    style={{ height: '100%' }}
                    data={deferredFilteredRules}
                    computeItemKey={(index, rule) => {
                      const originalIndex = ruleIndexMap.get(rule) ?? -1
                      return `${originalIndex}-${index}`
                    }}
                    itemContent={(index, rule) => {
                      const originalIndex = ruleIndexMap.get(rule) ?? -1
                      const isDeleted = deletedRules.has(originalIndex)
                      const isPrependOrAppend =
                        prependRules.has(originalIndex) || appendRules.has(originalIndex)
                      return (
                        <div className="pb-2">
                          <RuleListItem
                            rule={rule}
                            originalIndex={originalIndex}
                            isDeleted={isDeleted}
                            isPrependOrAppend={isPrependOrAppend}
                            rulesLength={rules.length}
                            onMoveUp={handleMoveRuleUp}
                            onMoveDown={handleMoveRuleDown}
                            onRemove={handleRemoveRule}
                          />
                        </div>
                      )
                    }}
                  />
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
