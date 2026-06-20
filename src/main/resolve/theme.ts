import { copyFile, readdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import AdmZip from 'adm-zip'
import { t } from 'i18next'
import { themesDir } from '../utils/dirs'
import * as chromeRequest from '../utils/chromeRequest'
import { getControledMihomoConfig } from '../config'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'
import { mainWindow } from '../window'
import { floatingWindow } from './floatingWindow'

let insertedCSSKeyMain: string | undefined = undefined
let insertedCSSKeyFloating: string | undefined = undefined

export async function resolveThemes(): Promise<{ key: string; label: string }[]> {
  const files = await readdir(themesDir())
  const themes = await Promise.all(
    files
      .filter((file) => file.endsWith('.css'))
      .map(async (file) => {
        const css = (await readFile(path.join(themesDir(), file), 'utf-8')) || ''
        let name = file
        if (css.startsWith('/*')) {
          name = css.split('\n')[0].replace('/*', '').replace('*/', '').trim() || file
        }
        return { key: file, label: name }
      })
  )
  if (themes.find((theme) => theme.key === 'default.css')) {
    return themes
  } else {
    return [{ key: 'default.css', label: t('common.default') }, ...themes]
  }
}

export async function fetchThemes(): Promise<void> {
  const zipUrl = 'https://github.com/mihomo-party-org/theme-hub/releases/download/latest/themes.zip'
  const { 'mixed-port': mixedPort = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  const zipData = await chromeRequest.get(zipUrl, {
    responseType: 'arraybuffer',
    headers: { 'Content-Type': 'application/octet-stream' },
    proxy: {
      protocol: 'http',
      host: '127.0.0.1',
      port: mixedPort
    }
  })
  const zip = new AdmZip(Buffer.from(zipData.data as Buffer))
  zip.extractAllTo(themesDir(), true)
}

export async function importThemes(files: string[]): Promise<void> {
  for (const file of files) {
    if (existsSync(file))
      await copyFile(
        file,
        path.join(themesDir(), `${new Date().getTime().toString(16)}-${path.basename(file)}`)
      )
  }
}

export async function readTheme(theme: string): Promise<string> {
  if (!existsSync(path.join(themesDir(), theme))) return ''
  return await readFile(path.join(themesDir(), theme), 'utf-8')
}

export async function writeTheme(theme: string, css: string): Promise<void> {
  await writeFile(path.join(themesDir(), theme), css)
}

export async function applyTheme(theme: string): Promise<void> {
  const css = await readTheme(theme)
  await mainWindow?.webContents.removeInsertedCSS(insertedCSSKeyMain || '')
  insertedCSSKeyMain = await mainWindow?.webContents.insertCSS(css)
  try {
    await floatingWindow?.webContents.removeInsertedCSS(insertedCSSKeyFloating || '')
    insertedCSSKeyFloating = await floatingWindow?.webContents.insertCSS(css)
  } catch {
    // ignore
  }
}
