import { execSync } from 'child_process'
import { readFileSync } from 'fs'

// 获取Git commit hash
export function getGitCommitHash(short = true) {
  try {
    const command = short ? 'git rev-parse --short HEAD' : 'git rev-parse HEAD'
    return execSync(command, { encoding: 'utf-8' }).trim()
  } catch (error) {
    console.warn('Failed to get git commit hash:', error.message)
    return 'unknown'
  }
}

// 获取当前月份日期
export function getCurrentMonthDate() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${month}${day}`
}

// 从package.json读取基础版本号
export function getBaseVersion() {
  try {
    const pkg = readFileSync('package.json', 'utf-8')
    const { version } = JSON.parse(pkg)
    // 移除dev版本格式后缀
    return version.replace(/-d\d{2,4}\.[a-f0-9]{7}$/, '')
  } catch (error) {
    console.error('Failed to read package.json:', error.message)
    return '1.0.0'
  }
}

// 生成dev版本号
export function getDevVersion() {
  const baseVersion = getBaseVersion()
  const monthDate = getCurrentMonthDate()
  const commitHash = getGitCommitHash(true)

  return `${baseVersion}-d${monthDate}.${commitHash}`
}

// 检查当前环境是否为dev构建
export function isDevBuild() {
  return (
    process.env.NODE_ENV === 'development' ||
    process.argv.includes('--dev') ||
    process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
  )
}

// 获取处理后的版本号
export function getProcessedVersion() {
  if (isDevBuild()) {
    return getDevVersion()
  } else {
    return getBaseVersion()
  }
}

// 生成下载URL
export function getDownloadUrl(isDev, version) {
  if (isDev) {
    return 'https://github.com/mihomo-party-org/clash-party/releases/download/dev'
  } else {
    return `https://github.com/mihomo-party-org/clash-party/releases/download/v${version}`
  }
}

export function generateDownloadLinksMarkdown(downloadUrl, version) {
  let links = '\n### 下载地址：\n\n#### Windows10/11：\n\n'
  links += `- 安装版：[64位](${downloadUrl}/clash-party-windows-${version}-x64-setup.exe) | [32位](${downloadUrl}/clash-party-windows-${version}-ia32-setup.exe) | [ARM64](${downloadUrl}/clash-party-windows-${version}-arm64-setup.exe)\n\n`
  links += `- 便携版：[64位](${downloadUrl}/clash-party-windows-${version}-x64-portable.7z) | [32位](${downloadUrl}/clash-party-windows-${version}-ia32-portable.7z) | [ARM64](${downloadUrl}/clash-party-windows-${version}-arm64-portable.7z)\n\n`
  links += '\n#### Windows7/8：\n\n'
  links += `- 安装版：[64位](${downloadUrl}/clash-party-win7-${version}-x64-setup.exe) | [32位](${downloadUrl}/clash-party-win7-${version}-ia32-setup.exe)\n\n`
  links += `- 便携版：[64位](${downloadUrl}/clash-party-win7-${version}-x64-portable.7z) | [32位](${downloadUrl}/clash-party-win7-${version}-ia32-portable.7z)\n\n`
  links += '\n#### macOS 11+：\n\n'
  links += `- PKG：[Intel](${downloadUrl}/clash-party-macos-${version}-x64.pkg) | [Apple Silicon](${downloadUrl}/clash-party-macos-${version}-arm64.pkg)\n\n`
  links += '\n#### macOS 10.15+：\n\n'
  links += `- PKG：[Intel](${downloadUrl}/clash-party-catalina-${version}-x64.pkg) | [Apple Silicon](${downloadUrl}/clash-party-catalina-${version}-arm64.pkg)\n\n`
  links += '\n#### Linux：\n\n'
  links += `- DEB：[64位](${downloadUrl}/clash-party-linux-${version}-amd64.deb) | [ARM64](${downloadUrl}/clash-party-linux-${version}-arm64.deb)\n\n`
  links += `- RPM：[64位](${downloadUrl}/clash-party-linux-${version}-x86_64.rpm) | [ARM64](${downloadUrl}/clash-party-linux-${version}-aarch64.rpm)`

  return links
}
