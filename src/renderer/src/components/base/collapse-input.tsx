import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Input, InputProps } from '@heroui/react'
import { FaSearch } from 'react-icons/fa'

interface CollapseInputProps extends Omit<InputProps, 'onValueChange'> {
  title: string
  onValueChange?: (value: string) => void
}

const CollapseInput: React.FC<CollapseInputProps> = (props) => {
  const { title, value, onValueChange, ...inputProps } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const isComposingRef = useRef(false)
  const mountedOnceRef = useRef(false)
  const [localValue, setLocalValue] = useState(value || '')
  const expanded = String(localValue ?? '').length > 0

  // 同步外部 value 变化
  React.useEffect(() => {
    if (!isComposingRef.current) {
      setLocalValue(value || '')
    }
  }, [value])

  // 输入框可能被宿主（如虚拟列表里的分组标题）在筛选结果变化时整块卸载重建，
  // 焦点随之丢失、输入框缩回宽度 0。带着搜索词重新挂载且焦点无处可去时把焦点收回来，
  // 用户才能继续输入而不是被打断（#332、#1621）。
  useEffect(() => {
    if (mountedOnceRef.current) return
    mountedOnceRef.current = true
    if (!value) return
    const active = document.activeElement
    if (active && active !== document.body) return
    inputRef.current?.focus({ preventScroll: true })
  }, [value])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      setLocalValue(newValue)
      // 只在非组合输入时触发外部更新
      if (!isComposingRef.current) {
        onValueChange?.(newValue)
      }
    },
    [onValueChange]
  )

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true
  }, [])

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLInputElement>) => {
      isComposingRef.current = false
      // 组合输入结束后，触发一次更新
      onValueChange?.(e.currentTarget.value)
    },
    [onValueChange]
  )

  return (
    <div className="flex">
      <Input
        size="sm"
        ref={inputRef}
        {...inputProps}
        value={localValue as string}
        onChange={handleChange}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        style={{ paddingInlineEnd: 0 }}
        classNames={{
          inputWrapper: 'cursor-pointer bg-transparent p-0 data-[hover=true]:bg-content2',
          // 有搜索词时保持展开，否则筛选一生效就缩回宽度 0，用户看不到也改不了当前条件
          input: `${expanded ? 'w-[150px] ml-2' : 'w-0'} focus:w-[150px] focus:ml-2 transition-all duration-200`
        }}
        endContent={
          <div
            className="cursor-pointer p-2 text-lg text-foreground-500"
            onClick={(e) => {
              e.stopPropagation()
              inputRef.current?.focus()
            }}
          >
            <FaSearch title={title} />
          </div>
        }
        onPress={(e) => {
          e.stopPropagation()
          inputRef.current?.focus()
        }}
      />
    </div>
  )
}

export default CollapseInput
