import yaml from 'yaml'
import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

const pkg = readFileSync('package.json', 'utf-8')
let changelog = readFileSync('changelog.md', 'utf-8')
let { version } = JSON.parse(pkg)

// 获取 commit hash
function getGitCommitHash() {
  try {
    return execSync('git rev-parse --short=7 HEAD').toString().trim()
  } catch (error) {
    console.warn('无法获取 Git commit hash，使用默认值')
    return 'unknown'
  }
}

if (version.endsWith('-dev')) {
  const commitHash = getGitCommitHash()
  version = version.replace('-dev', `-${commitHash}-dev`)
}
const isDevVersion = version.includes('-dev')
const downloadUrl = isDevVersion 
  ? `https://github.com/mihomo-party-org/clash-party/releases/download/dev`
  : `https://github.com/mihomo-party-org/clash-party/releases/download/v${version}`
const latest = {
  version,
  changelog
}

changelog += '\n### 下载地址：\n\n#### Windows10/11：\n\n'
changelog += `- 安装版：[64位](${downloadUrl}/clash-party-windows-${version}-x64-setup.exe) | [32位](${downloadUrl}/clash-party-windows-${version}-ia32-setup.exe) | [ARM64](${downloadUrl}/clash-party-windows-${version}-arm64-setup.exe)\n\n`
changelog += `- 便携版：[64位](${downloadUrl}/clash-party-windows-${version}-x64-portable.7z) | [32位](${downloadUrl}/clash-party-windows-${version}-ia32-portable.7z) | [ARM64](${downloadUrl}/clash-party-windows-${version}-arm64-portable.7z)\n\n`
changelog += '\n#### Windows7/8：\n\n'
changelog += `- 安装版：[64位](${downloadUrl}/clash-party-win7-${version}-x64-setup.exe) | [32位](${downloadUrl}/clash-party-win7-${version}-ia32-setup.exe)\n\n`
changelog += `- 便携版：[64位](${downloadUrl}/clash-party-win7-${version}-x64-portable.7z) | [32位](${downloadUrl}/clash-party-win7-${version}-ia32-portable.7z)\n\n`
changelog += '\n#### macOS 11+：\n\n'
changelog += `- PKG：[Intel](${downloadUrl}/clash-party-macos-${version}-x64.pkg) | [Apple Silicon](${downloadUrl}/clash-party-macos-${version}-arm64.pkg)\n\n`
changelog += '\n#### macOS 10.15+：\n\n'
changelog += `- PKG：[Intel](${downloadUrl}/clash-party-catalina-${version}-x64.pkg) | [Apple Silicon](${downloadUrl}/clash-party-catalina-${version}-arm64.pkg)\n\n`
changelog += '\n#### Linux：\n\n'
changelog += `- DEB：[64位](${downloadUrl}/clash-party-linux-${version}-amd64.deb) | [ARM64](${downloadUrl}/clash-party-linux-${version}-arm64.deb)\n\n`
changelog += `- RPM：[64位](${downloadUrl}/clash-party-linux-${version}-x86_64.rpm) | [ARM64](${downloadUrl}/clash-party-linux-${version}-aarch64.rpm)`

changelog += '\n\n### 机场推荐：\n- 高性能海外机场，稳定首选：[https://狗狗加速.com](https://party.dginv.click/#/register?code=ARdo0mXx)'

writeFileSync('latest.yml', yaml.stringify(latest))
writeFileSync('changelog.md', changelog)
