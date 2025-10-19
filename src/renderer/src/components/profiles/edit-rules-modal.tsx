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
  Divider
} from '@heroui/react'
import React, { useEffect, useState } from 'react'
import { getProfileStr, setProfileStr } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'
import yaml from 'js-yaml'
import { IoMdTrash, IoMdArrowUp, IoMdArrowDown, IoMdUndo } from 'react-icons/io'
import { MdVerticalAlignTop, MdVerticalAlignBottom } from 'react-icons/md'
import { platform } from '@renderer/utils/init'

interface Props {
  id: string
  onClose: () => void
}

interface RuleItem {
  type: string
  payload: string
  proxy: string
  additionalParams?: string[]
}

const portValidator = (value: string): boolean => {
  return new RegExp(
    "^(?:[1-9]\\d{0,3}|[1-5]\\d{4}|6[0-4]\\d{3}|65[0-4]\\d{2}|655[0-2]\\d|6553[0-5])$",
  ).test(value);
};

const ipv4CIDRValidator = (value: string): boolean => {
  return new RegExp(
    "^(?:(?:[1-9]?[0-9]|1[0-9][0-9]|2(?:[0-4][0-9]|5[0-5]))\\.){3}(?:[1-9]?[0-9]|1[0-9][0-9]|2(?:[0-4][0-9]|5[0-5]))(?:\\/(?:[12]?[0-9]|3[0-2]))$",
  ).test(value);
};

const ipv6CIDRValidator = (value: string): boolean => {
  return new RegExp(
    "^([0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){7}|::|:(?::[0-9a-fA-F]{1,4}){1,6}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,5}|(?:[0-9a-fA-F]{1,4}:){2}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){3}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){4}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){5}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,6}:)\\/(?:12[0-8]|1[01][0-9]|[1-9]?[0-9])$",
  ).test(value);
};

// 内置路由规则 https://wiki.metacubex.one/config/rules/
const ruleDefinitionsMap = new Map<string, {
  name: string;
  required?: boolean;
  example?: string;
  noResolve?: boolean;
  src?: boolean;
  validator?: (value: string) => boolean;
}>([
  ["DOMAIN", {
    name: "DOMAIN",
    example: "example.com",
  }],
  ["DOMAIN-SUFFIX", {
    name: "DOMAIN-SUFFIX",
    example: "example.com",
  }],
  ["DOMAIN-KEYWORD", {
    name: "DOMAIN-KEYWORD",
    example: "example",
  }],
  ["DOMAIN-REGEX", {
    name: "DOMAIN-REGEX",
    example: "example.*",
  }],
  ["GEOSITE", {
    name: "GEOSITE",
    example: "youtube",
  }],
  ["GEOIP", {
    name: "GEOIP",
    example: "CN",
    noResolve: true,
    src: true,
  }],
  ["SRC-GEOIP", {
    name: "SRC-GEOIP",
    example: "CN",
  }],
  ["IP-ASN", {
    name: "IP-ASN",
    example: "13335",
    noResolve: true,
    src: true,
    validator: (value) => (+value ? true : false),
  }],
  ["SRC-IP-ASN", {
    name: "SRC-IP-ASN",
    example: "9808",
    validator: (value) => (+value ? true : false),
  }],
  ["IP-CIDR", {
    name: "IP-CIDR",
    example: "127.0.0.0/8",
    noResolve: true,
    src: true,
    validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value),
  }],
  ["IP-CIDR6", {
    name: "IP-CIDR6",
    example: "2620:0:2d0:200::7/32",
    noResolve: true,
    src: true,
    validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value),
  }],
  ["SRC-IP-CIDR", {
    name: "SRC-IP-CIDR",
    example: "192.168.1.201/32",
    validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value),
  }],
  ["IP-SUFFIX", {
    name: "IP-SUFFIX",
    example: "8.8.8.8/24",
    noResolve: true,
    src: true,
    validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value),
  }],
  ["SRC-IP-SUFFIX", {
    name: "SRC-IP-SUFFIX",
    example: "192.168.1.201/8",
    validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value),
  }],
  ["SRC-PORT", {
    name: "SRC-PORT",
    example: "7777",
    validator: (value) => portValidator(value),
  }],
  ["DST-PORT", {
    name: "DST-PORT",
    example: "80",
    validator: (value) => portValidator(value),
  }],
  ["IN-PORT", {
    name: "IN-PORT",
    example: "7897",
    validator: (value) => portValidator(value),
  }],
  ["DSCP", {
    name: "DSCP",
    example: "4",
  }],
  ["PROCESS-NAME", {
    name: "PROCESS-NAME",
    example: platform === "win32" ? "chrome.exe" : "curl",
  }],
  ["PROCESS-PATH", {
    name: "PROCESS-PATH",
    example:
      platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : "/usr/bin/wget",
  }],
  ["PROCESS-NAME-REGEX", {
    name: "PROCESS-NAME-REGEX",
    example: ".*telegram.*",
  }],
  ["PROCESS-PATH-REGEX", {
    name: "PROCESS-PATH-REGEX",
    example:
      platform === "win32" ? "(?i).*Application\\chrome.*" : ".*bin/wget",
  }],
  ["NETWORK", {
    name: "NETWORK",
    example: "udp",
    validator: (value) => ["tcp", "udp"].includes(value),
  }],
  ["UID", {
    name: "UID",
    example: "1001",
    validator: (value) => (+value ? true : false),
  }],
  ["IN-TYPE", {
    name: "IN-TYPE",
    example: "SOCKS/HTTP",
  }],
  ["IN-USER", {
    name: "IN-USER",
    example: "mihomo",
  }],
  ["IN-NAME", {
    name: "IN-NAME",
    example: "ss",
  }],
  ["SUB-RULE", {
    name: "SUB-RULE",
    example: "(NETWORK,tcp)",
  }],
  ["RULE-SET", {
    name: "RULE-SET",
    example: "providername",
    noResolve: true,
    src: true,
  }],
  ["AND", {
    name: "AND",
    example: "((DOMAIN,baidu.com),(NETWORK,UDP))",
  }],
  ["OR", {
    name: "OR",
    example: "((NETWORK,UDP),(DOMAIN,baidu.com))",
  }],
  ["NOT", {
    name: "NOT",
    example: "((DOMAIN,baidu.com))",
  }],
  ["MATCH", {
    name: "MATCH",
    required: false,
  }],
]);

const ruleTypes = Array.from(ruleDefinitionsMap.keys());

const isRuleSupportsNoResolve = (ruleType: string): boolean => {
  const rule = ruleDefinitionsMap.get(ruleType);
  return rule?.noResolve === true;
};

const isRuleSupportsSrc = (ruleType: string): boolean => {
  const rule = ruleDefinitionsMap.get(ruleType);
  return rule?.src === true;
};

const getRuleExample = (ruleType: string): string => {
  const rule = ruleDefinitionsMap.get(ruleType);
  return rule?.example || '';
};

const isAddRuleDisabled = (newRule: RuleItem, validateRulePayload: (ruleType: string, payload: string) => boolean): boolean => {
  return (!(newRule.payload.trim() || newRule.type === 'MATCH')) || !newRule.type || 
    (newRule.type !== 'MATCH' && newRule.payload.trim() !== '' && !validateRulePayload(newRule.type, newRule.payload));
};

const EditRulesModal: React.FC<Props> = (props) => {
  const { id, onClose } = props
  const [rules, setRules] = useState<RuleItem[]>([])
  const [filteredRules, setFilteredRules] = useState<RuleItem[]>([])
  const [profileContent, setProfileContent] = useState('')
  const [newRule, setNewRule] = useState<RuleItem>({ type: 'DOMAIN', payload: '', proxy: 'DIRECT', additionalParams: [] })
  const [searchTerm, setSearchTerm] = useState('')
  const [proxyGroups, setProxyGroups] = useState<string[]>([])
  const [deletedRules, setDeletedRules] = useState<Set<number>>(new Set()) // Store indices of deleted rules
  const { t } = useTranslation()

  const getContent = async (): Promise<void> => {
    const content = await getProfileStr(id)
    setProfileContent(content)
    
    try {
      const parsed = yaml.load(content) as any
      if (parsed && parsed.rules && Array.isArray(parsed.rules)) {
        const parsedRules = parsed.rules.map((rule: string) => {
          const parts = rule.split(',')
          if (parts[0] === 'MATCH') {
            return {
              type: 'MATCH',
              proxy: parts[1]
            }
          } else {
            const additionalParams = parts.slice(3).filter(param => param.trim() !== '') || []
            return {
              type: parts[0],
              payload: parts[1],
              proxy: parts[2],
              additionalParams
            }
          }
        })
        setRules(parsedRules)
        setFilteredRules(parsedRules)
      }
      
      // 从配置文件中提取代理组
      if (parsed) {
        const groups: string[] = []
        
        // 添加代理组名称
        if (Array.isArray(parsed['proxy-groups'])) {
          groups.push(...parsed['proxy-groups'].map((group: any) => group?.name).filter(Boolean))
        }
        
        // 添加代理名称
        if (Array.isArray(parsed['proxies'])) {
          groups.push(...parsed['proxies'].map((proxy: any) => proxy?.name).filter(Boolean))
        }
        
        // 预置出站 https://wiki.metacubex.one/config/proxies/built-in/
        groups.push('DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE')
        
        // 去重
        setProxyGroups([...new Set(groups)])
      }
    } catch (e) {
      console.error('解析配置文件内容失败', e)
    }
  }

  useEffect(() => {
    getContent()
  }, [])

  useEffect(() => {
    if (searchTerm === '') {
      setFilteredRules(rules)
    } else {
      const filtered = rules.filter(rule => 
        rule.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
        rule.payload.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (rule.proxy && rule.proxy.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (rule.additionalParams && rule.additionalParams.some(param => param.toLowerCase().includes(searchTerm.toLowerCase())))
      )
      setFilteredRules(filtered)
    }
  }, [searchTerm, rules])

  const handleSave = async (): Promise<void> => {
    try {
      // 过滤掉已标记为删除的规则
      const rulesToSave = rules.filter((_, index) => !deletedRules.has(index));
      
      // 将规则转换回字符串格式
      const ruleStrings = rulesToSave.map(rule => {
        const parts = [rule.type]
        if (rule.payload) parts.push(rule.payload)
        if (rule.proxy) parts.push(rule.proxy)
        if (rule.additionalParams && rule.additionalParams.length > 0) {
          parts.push(...rule.additionalParams)
        }
        return parts.join(',')
      })
      
      // 直接在原始内容中替换规则部分，保持原有格式
      let updatedContent = profileContent
      
      // 将内容按行分割，便于处理
      const lines = profileContent.split('\n')
      const newLines: string[] = []
      let inRulesSection = false
      let rulesSectionFound = false
      let rulesIndent = ''
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const trimmedLine = line.trim()
        
        // 检查是否是 rules: 开始行
        if (trimmedLine === 'rules:') {
          rulesSectionFound = true
          inRulesSection = true
          rulesIndent = line.match(/^\s*/)?.[0] || ''
          newLines.push(line) // 保留 rules: 行
          
          // 添加新的规则行
          for (const rule of ruleStrings) {
            newLines.push(`${rulesIndent}  - ${rule}`)
          }
          
          // 跳过原有的 rules 内容
          while (i + 1 < lines.length) {
            const nextLine = lines[i + 1]
            const nextTrimmed = nextLine.trim()
            const nextIndent = nextLine.match(/^\s*/)?.[0] || ''
            
            // 如果下一行不是空行且缩进大于 rules 缩进，说明还是 rules 的内容
            if (nextTrimmed !== '' && nextIndent.length > rulesIndent.length) {
              i++ // 跳过这一行
            } else {
              break
            }
          }
          continue
        }
        
        // 如果在 rules 部分中，跳过处理
        if (inRulesSection && trimmedLine.startsWith('-')) {
          // 检查是否还有 rules 行
          const currentIndent = line.match(/^\s*/)?.[0] || ''
          if (currentIndent.length > rulesIndent.length) {
            continue // 跳过原有规则行
          } else {
            inRulesSection = false // rules 部分结束
          }
        }
        
        newLines.push(line)
      }
      
      // 如果没有找到 rules 部分，添加到文件末尾
      if (!rulesSectionFound) {
        newLines.push('') // 空行
        newLines.push('rules:')
        for (const rule of ruleStrings) {
          newLines.push(`  - ${rule}`)
        }
      }
      
      updatedContent = newLines.join('\n')
      
      await setProfileStr(id, updatedContent)
      onClose()
    } catch (e) {
      alert(t('profiles.editRules.saveError') + ': ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handleRuleTypeChange = (selected: string): void => {
    const noResolveSupported = isRuleSupportsNoResolve(selected);
    const srcSupported = isRuleSupportsSrc(selected);

    let additionalParams = [...(newRule.additionalParams || [])];
    if (!noResolveSupported) {
      additionalParams = additionalParams.filter(param => param !== 'no-resolve');
    }
    if (!srcSupported) {
      additionalParams = additionalParams.filter(param => param !== 'src');
    }
    
    setNewRule({
      ...newRule,
      type: selected,
      additionalParams: additionalParams.length > 0 ? additionalParams : []
    });
  };

  const handleAdditionalParamChange = (param: string, checked: boolean): void => {
    let newAdditionalParams = [...(newRule.additionalParams || [])];
    
    if (checked) {
      if (!newAdditionalParams.includes(param)) {
        newAdditionalParams.push(param);
      }
    } else {
      newAdditionalParams = newAdditionalParams.filter(p => p !== param);
    }
    
    setNewRule({ 
      ...newRule, 
      additionalParams: newAdditionalParams
    });
  };

  const handleAddRule = (position: 'prepend' | 'append' = 'append'): void => {
    if (newRule.type === 'MATCH' || newRule.payload.trim() !== '') {
      if (newRule.type !== 'MATCH' && newRule.payload.trim() !== '' && !validateRulePayload(newRule.type, newRule.payload)) {
        alert(t('profiles.editRules.invalidPayload') + ': ' + getRuleExample(newRule.type));
        return;
      }
      
      const newRuleItem = { ...newRule };
      let updatedRules: RuleItem[];
      
      if (position === 'prepend') {
        updatedRules = [newRuleItem, ...rules];
      } else {
        updatedRules = [...rules, newRuleItem];
      }
      
      setRules(updatedRules)
      setFilteredRules(updatedRules)
      setNewRule({ type: 'DOMAIN', payload: '', proxy: 'DIRECT', additionalParams: [] })
    }
  }

  const handleRemoveRule = (index: number): void => {
    setDeletedRules(prev => {
      const newSet = new Set(prev)
      if (newSet.has(index)) {
        newSet.delete(index) // 如果已经标记为删除，则取消标记
      } else {
        newSet.add(index) // 标记为删除
      }
      return newSet
    })
  }

  const handleMoveRuleUp = (index: number): void => {
    if (index <= 0) return
    const updatedRules = [...rules]
    const temp = updatedRules[index]
    updatedRules[index] = updatedRules[index - 1]
    updatedRules[index - 1] = temp
    setRules(updatedRules)
    setFilteredRules(updatedRules)
    setDeletedRules(prev => {
      const newSet = new Set<number>()
      prev.forEach(idx => {
        if (idx === index) {
          newSet.add(index - 1)
        } else if (idx === index - 1) {
          newSet.add(index)
        } else {
          newSet.add(idx)
        }
      })
      return newSet
    })
  }

  const handleMoveRuleDown = (index: number): void => {
    if (index >= rules.length - 1) return
    const updatedRules = [...rules]
    const temp = updatedRules[index]
    updatedRules[index] = updatedRules[index + 1]
    updatedRules[index + 1] = temp
    setRules(updatedRules)
    setFilteredRules(updatedRules)
    setDeletedRules(prev => {
      const newSet = new Set<number>()
      prev.forEach(idx => {
        if (idx === index) {
          newSet.add(index + 1)
        } else if (idx === index + 1) {
          newSet.add(index)
        } else {
          newSet.add(idx)
        }
      })
      return newSet
    })
  }

  const validateRulePayload = (ruleType: string, payload: string): boolean => {
    if (ruleType === 'MATCH') {
      return true;
    }

    const validator = getRuleValidator(ruleType);
    if (!validator) {
      return true;
    }

    return validator(payload);
  };

  const getRuleValidator = (ruleType: string): ((value: string) => boolean) | undefined => {
    const rule = ruleDefinitionsMap.get(ruleType);
    return rule?.validator;
  };

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
                    <SelectItem key={type}>
                      {type}
                    </SelectItem>
                  ))}
                </Select>
                
                <Input
                  label={t('profiles.editRules.payload')}
                  placeholder={getRuleExample(newRule.type) || t('profiles.editRules.payloadPlaceholder')}
                  value={newRule.payload}
                  onValueChange={(value) => setNewRule({ ...newRule, payload: value })}
                  isDisabled={newRule.type === 'MATCH'}
                  color={newRule.payload && newRule.type !== 'MATCH' && !validateRulePayload(newRule.type, newRule.payload) ? "danger" : "default"}
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
                          onValueChange={(checked) => handleAdditionalParamChange('no-resolve', checked)}
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
                <h3 className="text-lg font-semibold mb-2">{t('profiles.editRules.instructions')}</h3>
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
                {filteredRules.length === 0 ? (
                  <div className="text-center text-foreground-500 py-4">
                    {rules.length === 0 
                      ? t('profiles.editRules.noRules') 
                      : searchTerm 
                        ? t('profiles.editRules.noMatchingRules') 
                        : t('profiles.editRules.noRules')}
                  </div>
                ) : (
                  filteredRules.map((rule) => {
                    const originalIndex = rules.indexOf(rule);
                    return (
                      <div key={originalIndex} className={`flex items-center gap-2 p-2 rounded-lg ${deletedRules.has(originalIndex) ? 'bg-danger-50 opacity-70' : 'bg-content2'}`}>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1">
                            <Chip size="sm" variant="flat">
                              {rule.type}
                            </Chip>
                            {/* 显示附加参数 */}
                            <div className="flex gap-1">
                              {rule.additionalParams && rule.additionalParams.length > 0 && (
                                rule.additionalParams.map((param, idx) => (
                                  <Chip key={idx} size="sm" variant="flat" color="secondary">{param}</Chip>
                                ))
                              )}  
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {rule.type === 'MATCH' ? rule.proxy : rule.payload}
                          </div>
                          {rule.proxy && rule.type !== 'MATCH' && (
                            <div className="text-sm text-foreground-500 truncate">{rule.proxy}</div>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button 
                            size="sm" 
                            variant="light"
                            onPress={() => handleMoveRuleUp(originalIndex)}
                            isIconOnly
                            isDisabled={originalIndex === 0 || deletedRules.has(originalIndex)}
                          >
                            <IoMdArrowUp className="text-lg" />
                          </Button>
                          <Button 
                            size="sm" 
                            variant="light"
                            onPress={() => handleMoveRuleDown(originalIndex)}
                            isIconOnly
                            isDisabled={originalIndex === rules.length - 1 || deletedRules.has(originalIndex)}
                          >
                            <IoMdArrowDown className="text-lg" />
                          </Button>
                          <Button 
                            size="sm" 
                            color={deletedRules.has(originalIndex) ? "success" : "danger"}
                            variant="light"
                            onPress={() => handleRemoveRule(originalIndex)}
                            isIconOnly
                          >
                            {deletedRules.has(originalIndex) ? <IoMdUndo className="text-lg" /> : <IoMdTrash className="text-lg" />}
                          </Button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </ModalBody>
        <ModalFooter className="pt-0">
          <Button size="sm" variant="light" onPress={() => {
            setDeletedRules(new Set()) // 清除删除状态
            onClose()
          }}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            color="primary"
            onPress={handleSave}
          >
            {t('common.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditRulesModal