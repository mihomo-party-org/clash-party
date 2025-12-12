import { readFileSync, readdirSync, writeFileSync, copyFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * 复制打包产物并重命名为兼容旧版本的文件名
 * 将 clash-party 重命名为 mihomo-party，用于更新检测兼容性
 */

const distDir = 'dist'

if (!existsSync(distDir)) {
  console.log('❌ dist 目录不存在，请先执行打包命令')
  process.exit(1)
}

const files = readdirSync(distDir)
console.log('📦 开始处理打包产物...')

let copiedCount = 0

for (const file of files) {
  if (file.includes('clash-party') && !file.endsWith('.sha256')) {
    const newFileName = file.replace('clash-party', 'mihomo-party')
    const sourcePath = join(distDir, file)
    const targetPath = join(distDir, newFileName)

    try {
      copyFileSync(sourcePath, targetPath)
      console.log(`✅ 复制: ${file} -> ${newFileName}`)
      copiedCount++

      const sha256File = `${file}.sha256`
      const sha256Path = join(distDir, sha256File)

      if (existsSync(sha256Path)) {
        const newSha256File = `${newFileName}.sha256`
        const newSha256Path = join(distDir, newSha256File)

        const sha256Content = readFileSync(sha256Path, 'utf8')
        writeFileSync(newSha256Path, sha256Content)
        console.log(`✅ 复制校验文件: ${sha256File} -> ${newSha256File}`)
        copiedCount++
      }
    } catch (error) {
      console.error(`❌ 复制文件失败: ${file}`, error.message)
    }
  }
}

if (copiedCount > 0) {
  console.log(`🎉 成功复制 ${copiedCount} 个文件`)
  console.log('📋 现在 dist 目录包含以下文件:')

  const finalFiles = readdirSync(distDir).sort()
  finalFiles.forEach((file) => {
    if (file.includes('clash-party') || file.includes('mihomo-party')) {
      const isLegacy = file.includes('mihomo-party')
      console.log(`   ${isLegacy ? '🔄' : '📦'} ${file}`)
    }
  })

  console.log('   📦 = 原始文件 (clash-party)')
  console.log('   🔄 = 兼容文件 (mihomo-party)')
} else {
  console.log('ℹ️  没有找到需要复制的 clash-party 文件')
}
