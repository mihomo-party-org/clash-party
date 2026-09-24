import { Divider } from '@heroui/react'
import React from 'react'

interface Props {
  title: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  divider?: boolean
  stackOnSmallScreens?: boolean
}

const SettingItem: React.FC<Props> = (props) => {
  const { title, actions, children, divider = false, stackOnSmallScreens = false } = props

  return (
    <>
      <div
        className={`select-text w-full flex justify-between ${
          stackOnSmallScreens
            ? 'min-h-8 flex-col gap-2 sm:flex-row sm:items-center sm:gap-0'
            : 'h-8'
        }`}
      >
        <div className={`${stackOnSmallScreens ? 'min-h-8' : 'h-full'} flex items-center`}>
          <h4 className="text-md leading-8 whitespace-nowrap">{title}</h4>
          <div>{actions}</div>
        </div>
        {children}
      </div>
      {divider && <Divider className="my-2" />}
    </>
  )
}

export default SettingItem
