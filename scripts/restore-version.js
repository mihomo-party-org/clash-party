const fs = require('fs')
const path = require('path')

function restoreVersion() {
  const backupPath = path.join(__dirname, '..', 'package.json.bak')
  const packagePath = path.join(__dirname, '..', 'package.json')

  if (fs.existsSync(backupPath)) {
    try {
      const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

      // 恢复版本号
      packageJson.version = backup.version
      fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2))

      // 删除备份文件
      fs.unlinkSync(backupPath)

      console.log(`版本号已恢复: ${backup.version}`)
    } catch (error) {
      console.error('恢复版本号时出错:', error)
    }
  }
}

// 如果是直接运行此脚本，则执行版本恢复
if (require.main === module) {
  restoreVersion()
}

module.exports = { restoreVersion }
