import { Button } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { CgWebsite } from 'react-icons/cg'
import { IoLogoGithub } from 'react-icons/io5'
import WebdavConfig from '@renderer/components/settings/webdav-config'
import GeneralConfig from '@renderer/components/settings/general-config'
import MihomoConfig from '@renderer/components/settings/mihomo-config'
import Actions from '@renderer/components/settings/actions'
import ShortcutConfig from '@renderer/components/settings/shortcut-config'
import { FaTelegramPlane } from 'react-icons/fa'
import SiderConfig from '@renderer/components/settings/sider-config'
import SubStoreConfig from '@renderer/components/settings/substore-config'
import { useTranslation } from 'react-i18next'

const Settings: React.FC = () => {
  const { t } = useTranslation()

  return (
    <BasePage
      title={t('settings.title')}
      header={
        <>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            title={t('settings.links.docs')}
            className="app-nodrag"
            onPress={() => {
              window.open('https://mihomo.party')
            }}
          >
            <CgWebsite className="text-lg" />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            className="app-nodrag"
            title={t('settings.links.github')}
            onPress={() => {
              window.open('https://github.com/mihomo-party-org/mihomo-party')
            }}
          >
            <IoLogoGithub className="text-lg" />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            className="app-nodrag"
            title={t('settings.links.telegram')}
            onPress={() => {
              window.open('https://t.me/mihomo_party_group')
            }}
          >
            <FaTelegramPlane className="text-lg" />
          </Button>
        </>
      }
    >
      <GeneralConfig />
      <SubStoreConfig />
      <SiderConfig />
      <WebdavConfig />
      <MihomoConfig />
      <ShortcutConfig />
      <Actions />
    </BasePage>
  )
}

export default Settings
