import React, { useState, useEffect, useRef } from 'react'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input } from '@heroui/react'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useTranslation } from 'react-i18next'
import { MdEdit, MdDelete, MdOpenInNew } from 'react-icons/md'

interface WebUIPanel {
  id: string
  name: string
  url: string
  isDefault?: boolean
}

// 用于高亮显示URL中的变量
const HighlightedUrl: React.FC<{ url: string }> = ({ url }) => {
  const parts = url.split(/(%host|%port|%secret)/g)
  
  return (
    <p className="text-sm text-default-500 break-all">
      {parts.map((part, index) => {
        if (part === '%host' || part === '%port' || part === '%secret') {
          return (
            <span key={index} className="bg-warning-200 text-warning-800 px-1 rounded">
              {part}
            </span>
          )
        }
        return part
      })}
    </p>
  )
}

// 可点击的变量标签组件
const ClickableVariableTag: React.FC<{ 
  variable: string; 
  onClick: (variable: string) => void 
}> = ({ variable, onClick }) => {
  return (
    <span 
      className="bg-warning-200 text-warning-800 px-1 rounded ml-1 cursor-pointer hover:bg-warning-300"
      onClick={() => onClick(variable)}
    >
      {variable}
    </span>
  )
}

const WebUIConfig: React.FC = () => {
  const { t } = useTranslation()
  const { controledMihomoConfig } = useControledMihomoConfig()
  
  const externalController = controledMihomoConfig?.['external-controller'] || ''
  const secret = controledMihomoConfig?.secret || ''
  
  // 解析主机和端口
  const parseController = () => {
    if (externalController) {
      const [host, port] = externalController.split(':')
      return { host: host.replace('0.0.0.0', '127.0.0.1'), port }
    }
    return { host: '127.0.0.1', port: '9090' }
  }
  
  const { host, port } = parseController()
  
  // 默认WebUI面板选项
  const defaultWebUIPanels: WebUIPanel[] = [
    {
      id: 'metacubexd',
      name: 'MetaCubeXD',
      url: 'https://metacubex.github.io/metacubexd/#/setup?http=true&hostname=%host&port=%port&secret=%secret',
      isDefault: true
    },
    {
      id: 'yacd',
      name: 'YACD',
      url: 'https://yacd.metacubex.one/?hostname=%host&port=%port&secret=%secret',
      isDefault: true
    },
    {
      id: 'zashboard',
      name: 'Zashboard',
      url: 'https://board.zash.run.place/#/setup?http=true&hostname=%host&port=%port&secret=%secret',
      isDefault: true
    }
  ]
  
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [allPanels, setAllPanels] = useState<WebUIPanel[]>([])
  const [editingPanel, setEditingPanel] = useState<WebUIPanel | null>(null)
  const [newPanelName, setNewPanelName] = useState('')
  const [newPanelUrl, setNewPanelUrl] = useState('')
  

  const urlInputRef = useRef<HTMLInputElement>(null)
  
  // 初始化面板列表
  useEffect(() => {
    const savedPanels = localStorage.getItem('webui-panels')
    if (savedPanels) {
      setAllPanels(JSON.parse(savedPanels))
    } else {
      setAllPanels(defaultWebUIPanels)
    }
  }, [])
  
  // 保存面板列表到localStorage
  useEffect(() => {
    if (allPanels.length > 0) {
      localStorage.setItem('webui-panels', JSON.stringify(allPanels))
    }
  }, [allPanels])
  
  // 在URL输入框光标处插入或替换变量
  const insertVariableAtCursor = (variable: string) => {
    if (!urlInputRef.current) return
    
    const input = urlInputRef.current
    const start = input.selectionStart || 0
    const end = input.selectionEnd || 0
    const currentValue = newPanelUrl || ''
    
    // 如果有选中文本，则替换选中的文本
    const newValue = currentValue.substring(0, start) + variable + currentValue.substring(end)
    
    setNewPanelUrl(newValue)
    
    // 设置光标位置到插入变量之后
    setTimeout(() => {
      if (urlInputRef.current) {
        const newCursorPos = start + variable.length
        urlInputRef.current.setSelectionRange(newCursorPos, newCursorPos)
        urlInputRef.current.focus()
      }
    }, 0)
  }
  
  // 打开WebUI面板
  const openWebUI = (panel: WebUIPanel) => {
    const url = panel.url
      .replace('%host', host)
      .replace('%port', port)
      .replace('%secret', secret)
    window.open(url, '_blank')
  }
  
  // 添加新面板
  const addNewPanel = () => {
    if (newPanelName && newPanelUrl) {
      const newPanel: WebUIPanel = {
        id: Date.now().toString(),
        name: newPanelName,
        url: newPanelUrl
      }
      setAllPanels([...allPanels, newPanel])
      setNewPanelName('')
      setNewPanelUrl('')
      setEditingPanel(null)
    }
  }
  
  // 更新面板
  const updatePanel = () => {
    if (editingPanel && newPanelName && newPanelUrl) {
      const updatedPanels = allPanels.map(panel => 
        panel.id === editingPanel.id 
          ? { ...panel, name: newPanelName, url: newPanelUrl } 
          : panel
      )
      setAllPanels(updatedPanels)
      setEditingPanel(null)
      setNewPanelName('')
      setNewPanelUrl('')
    }
  }
  
  // 删除面板
  const deletePanel = (id: string) => {
    setAllPanels(allPanels.filter(panel => panel.id !== id))
  }
  
  // 开始编辑面板
  const startEditing = (panel: WebUIPanel) => {
    setEditingPanel(panel)
    setNewPanelName(panel.name)
    setNewPanelUrl(panel.url)
  }
  
  // 取消编辑
  const cancelEditing = () => {
    setEditingPanel(null)
    setNewPanelName('')
    setNewPanelUrl('')
  }
  
  // 恢复默认面板
  const restoreDefaultPanels = () => {
    setAllPanels(defaultWebUIPanels)
  }

  return (
    <SettingCard>
      <SettingItem title={t('settings.webui.title')} divider>
        <div className="flex gap-2">
          <Button 
            size="sm" 
            color="primary" 
            onPress={() => setIsModalOpen(true)}
          >
            {t('settings.webui.manage')}
          </Button>
        </div>
      </SettingItem>
      <SettingItem title={t('settings.webui.currentConfig')}>
        <div className="text-sm text-default-500">
          <p>{t('settings.webui.host')}: {host}</p>
          <p>{t('settings.webui.port')}: {port}</p>
        </div>
      </SettingItem>
      
      {/* 面板管理模态框 */}
      <Modal 
        isOpen={isModalOpen} 
        onOpenChange={setIsModalOpen}
        size="5xl"
        scrollBehavior="inside"
        backdrop="blur"
        classNames={{ backdrop: 'top-[48px]' }}
        hideCloseButton
      >
        <ModalContent className="h-full w-[calc(100%-100px)]">
          <ModalHeader className="flex pb-0 app-drag">
            {t('settings.webui.manage')}
          </ModalHeader>
          <ModalBody className="flex flex-col h-full">
            <div className="flex flex-col h-full">
              {/* 添加/编辑面板表单 */}
              <div className="flex flex-col gap-2 p-3 bg-default-100 rounded-lg flex-shrink-0">
                <Input
                  label={t('settings.webui.panelName')}
                  placeholder={t('settings.webui.panelNamePlaceholder')}
                  value={newPanelName}
                  onValueChange={setNewPanelName}
                />
                <Input
                  ref={urlInputRef}
                  label={t('settings.webui.panelUrl')}
                  placeholder={t('settings.webui.panelUrlPlaceholder')}
                  value={newPanelUrl}
                  onValueChange={setNewPanelUrl}
                />
                <div className="text-xs text-default-500">
                  {t('settings.webui.variableHint')}:
                  <ClickableVariableTag variable="%host" onClick={insertVariableAtCursor} />
                  <ClickableVariableTag variable="%port" onClick={insertVariableAtCursor} />
                  <ClickableVariableTag variable="%secret" onClick={insertVariableAtCursor} />
                </div>
                <div className="flex gap-2">
                  {editingPanel ? (
                    <>
                      <Button 
                        size="sm" 
                        color="primary"
                        onPress={updatePanel}
                        isDisabled={!newPanelName || !newPanelUrl}
                      >
                        {t('common.save')}
                      </Button>
                      <Button 
                        size="sm" 
                        color="default"
                        variant="bordered"
                        onPress={cancelEditing}
                      >
                        {t('common.cancel')}
                      </Button>
                    </>
                  ) : (
                    <Button 
                      size="sm" 
                      color="primary"
                      onPress={addNewPanel}
                      isDisabled={!newPanelName || !newPanelUrl}
                    >
                      {t('settings.webui.addPanel')}
                    </Button>
                  )}
                  <Button 
                    size="sm" 
                    color="warning"
                    variant="bordered"
                    onPress={restoreDefaultPanels}
                  >
                    {t('settings.webui.restoreDefaults')}
                  </Button>
                </div>
              </div>
              
              {/* 面板列表 */}
              <div className="flex flex-col gap-2 mt-2 overflow-y-auto flex-grow">
                <h3 className="text-lg font-semibold">{t('settings.webui.panels')}</h3>
                {allPanels.map(panel => (
                  <div key={panel.id} className="flex items-start justify-between p-3 bg-default-50 rounded-lg flex-shrink-0">
                    <div className="flex-1 mr-2">
                      <p className="font-medium">{panel.name}</p>
                      <HighlightedUrl url={panel.url} />
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        isIconOnly 
                        size="sm" 
                        color="primary"
                        onPress={() => openWebUI(panel)}
                      >
                        <MdOpenInNew />
                      </Button>
                      <Button 
                        isIconOnly 
                        size="sm" 
                        color="warning"
                        onPress={() => startEditing(panel)}
                      >
                        <MdEdit />
                      </Button>
                      <Button 
                        isIconOnly 
                        size="sm" 
                        color="danger"
                        onPress={() => deletePanel(panel.id)}
                      >
                        <MdDelete />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </ModalBody>
          <ModalFooter className="pt-0">
            <Button 
              color="primary" 
              onPress={() => setIsModalOpen(false)}
            >
              {t('common.close')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </SettingCard>
  )
}

export default WebUIConfig