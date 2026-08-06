import React from 'react'
import { cn, Switch, SwitchProps } from '@heroui/react'
import './border-switch.css'

interface BorderSwitchProps extends Omit<SwitchProps, 'isSelected'> {
  isShowBorder?: boolean
  isSelected?: boolean
}

const BorderSwitch: React.FC<BorderSwitchProps> = (props) => {
  const { isShowBorder = false, isSelected = false, classNames, ...switchProps } = props

  return (
    <Switch
      className="border-switch px-[8px]"
      classNames={{
        wrapper: cn('border-2', {
          'border-transparent': !isShowBorder,
          'border-primary-foreground': isShowBorder
        }),
        thumb: cn('absolute z-4', 'transform -translate-x-[2px]'),
        ...classNames
      }}
      size="sm"
      isSelected={isSelected}
      {...switchProps}
    />
  )
}

export default BorderSwitch
