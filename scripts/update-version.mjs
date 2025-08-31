import { readFileSync, writeFileSync } from 'fs'
import { getProcessedVersion, isDevBuild } from './version-utils.mjs'

// 更新package.json中的版本号
function updatePackageVersion() {
  try {
    const packagePath = 'package.json'
    const packageContent = readFileSync(packagePath, 'utf-8')
    const packageData = JSON.parse(packageContent)

    // 获取处理后的版本号
    const newVersion = getProcessedVersion()
    
    console.log(`当前版本: ${packageData.version}`)
    console.log(`${isDevBuild() ? 'Dev构建' : '正式构建'} - 新版本: ${newVersion}`)

    packageData.version = newVersion

    // 写回package.json
    writeFileSync(packagePath, JSON.stringify(packageData, null, 2) + '\n')

    console.log(`✅ package.json版本号已更新为: ${newVersion}`)

  } catch (error) {
    console.error('❌ 更新package.json版本号失败:', error.message)
    process.exit(1)
  }
}

updatePackageVersion()

export { updatePackageVersion }