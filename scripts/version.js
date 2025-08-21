const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function getGitCommitHash() {
  try {
    return execSync('git rev-parse --short=7 HEAD').toString().trim()
  } catch (error) {
    console.warn('无法获取 Git commit hash，使用默认值')
    return 'unknown'
  }
}

function processVersion() {
  const packagePath = path.join(__dirname, '..', 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

  // 备份原始版本号
  const originalVersion = packageJson.version
  fs.writeFileSync(
    path.join(__dirname, '..', 'package.json.bak'),
    JSON.stringify({ version: originalVersion }, null, 2)
  )

  // 检查版本号是否以 -dev 结尾
  if (originalVersion.endsWith('-dev')) {
    const commitHash = getGitCommitHash()
    const newVersion = originalVersion.replace('-dev', `-${commitHash}-dev`)

    // 更新 package.json
    packageJson.version = newVersion
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2))

    console.log(`版本号已更新: ${originalVersion} -> ${newVersion}`)
    return newVersion
  }

  console.log(`版本号未修改: ${originalVersion}`)
  return originalVersion
}

// 如果是直接运行此脚本，则执行版本处理
if (require.main === module) {
  processVersion()
}

module.exports = { processVersion, getGitCommitHash }
