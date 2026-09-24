import { useCallback, useRef } from 'react'
import type { CompositionEvent } from 'react'

/**
 * HeroUI Input 的 onValueChange 在中文输入法组词期间也会触发，
 * 导致筛选条件被拼音中间态打断（微信输入法等，#1621）。
 * 组合输入中暂存到 ref，compositionend 再提交最终文本。
 */
export function useImeSafeValueChange(setter: (value: string) => void): {
  onValueChange: (value: string) => void
  onCompositionStart: () => void
  onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => void
} {
  const isComposingRef = useRef(false)

  const onValueChange = useCallback(
    (value: string): void => {
      if (isComposingRef.current) return
      setter(value)
    },
    [setter]
  )

  const onCompositionStart = useCallback((): void => {
    isComposingRef.current = true
  }, [])

  const onCompositionEnd = useCallback(
    (event: CompositionEvent<HTMLInputElement>): void => {
      isComposingRef.current = false
      setter(event.currentTarget.value)
    },
    [setter]
  )

  return { onValueChange, onCompositionStart, onCompositionEnd }
}
