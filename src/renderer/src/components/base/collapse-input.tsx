import React, { useRef, useState, useCallback } from 'react'
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
  const [localValue, setLocalValue] = useState(value || '')
  const lastValueRef = useRef(value)

  // 同步外部 value 变化（但不在组合输入时同步）
  React.useEffect(() => {
    // 只有当外部值真正改变且不在组合输入时才同步
    if (!isComposingRef.current && value !== lastValueRef.current) {
      setLocalValue(value || '')
      lastValueRef.current = value
    }
  }, [value])

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true
  }, [])

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLInputElement>) => {
      isComposingRef.current = false
      const composedValue = e.currentTarget.value
      setLocalValue(composedValue)
      lastValueRef.current = composedValue
      // 组合输入结束后，触发一次更新
      onValueChange?.(composedValue)
    },
    [onValueChange]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      // 在组合输入时也更新本地状态，保证输入框显示正确
      setLocalValue(newValue)
      // 只在非组合输入时触发外部更新
      if (!isComposingRef.current) {
        lastValueRef.current = newValue
        onValueChange?.(newValue)
      }
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
          input: 'w-0 focus:w-[150px] focus:ml-2 transition-all duration-200'
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
