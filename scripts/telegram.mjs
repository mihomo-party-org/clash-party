import axios from 'axios'
import { readFileSync } from 'fs'

const chat_id = '@MihomoPartyChannel'
const pkg = readFileSync('package.json', 'utf-8')
const changelog = readFileSync('changelog.md', 'utf-8')
const { version } = JSON.parse(pkg)

const releaseType = process.env.RELEASE_TYPE || process.argv[2] || 'release'
const isDevRelease = releaseType === 'dev'

function convertMarkdownToTelegramHTML(content) {
  return content
    .split("\n")
    .map((line) => {
      if (line.trim().length === 0) {
        return "";
      } else if (line.startsWith("## ")) {
        return `<b>${line.replace("## ", "")}</b>`;
      } else if (line.startsWith("### ")) {
        return `<b>${line.replace("### ", "")}</b>`;
      } else if (line.startsWith("#### ")) {
        return `<b>${line.replace("#### ", "")}</b>`;
      } else {
        let processedLine = line.replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          (match, text, url) => {
            const encodedUrl = encodeURI(url);
            return `<a href="${encodedUrl}">${text}</a>`;
          },
        );
        processedLine = processedLine.replace(
          /\*\*([^*]+)\*\*/g,
          "<b>$1</b>",
        );
        return processedLine;
      }
    })
    .join("\n");
}

let content = '';

if (isDevRelease) {

  const commitSha = process.env.GITHUB_SHA || 'unknown'
  const shortCommitSha = commitSha.substring(0, 7)
  
  content = `<b>🚧 <a href="https://github.com/mihomo-party-org/mihomo-party/releases/tag/dev">Clash Party Dev Build</a> 开发版本发布</b>\n\n`
  content += `<b>基于版本:</b> ${version}\n`
  content += `<b>提交哈希:</b> <a href="https://github.com/mihomo-party-org/mihomo-party/commit/${commitSha}">${shortCommitSha}</a>\n\n`
  content += `<b>更新日志:</b>\n`
  content += convertMarkdownToTelegramHTML(changelog)
  content += '\n\n<b>⚠️ 注意：这是开发版本，可能存在不稳定性，仅供测试使用</b>\n'
} else {
  // 正式版本通知
  content = `<b>🌟 <a href="https://github.com/mihomo-party-org/mihomo-party/releases/tag/v${version}">Clash Party v${version}</a> 正式发布</b>\n\n`
  content += convertMarkdownToTelegramHTML(changelog)
}

// 构建下载链接
const downloadUrl = isDevRelease 
  ? `https://github.com/mihomo-party-org/mihomo-party/releases/download/dev`
  : `https://github.com/mihomo-party-org/mihomo-party/releases/download/v${version}`

content += '\n<b>下载地址：</b>\n<b>Windows10/11：</b>\n'
content += `安装版：<a href="${downloadUrl}/mihomo-party-windows-${version}-x64-setup.exe">64位</a> | <a href="${downloadUrl}/mihomo-party-windows-${version}-ia32-setup.exe">32位</a> | <a href="${downloadUrl}/mihomo-party-windows-${version}-arm64-setup.exe">ARM64</a>\n`
content += `便携版：<a href="${downloadUrl}/mihomo-party-windows-${version}-x64-portable.7z">64位</a> | <a href="${downloadUrl}/mihomo-party-windows-${version}-ia32-portable.7z">32位</a> | <a href="${downloadUrl}/mihomo-party-windows-${version}-arm64-portable.7z">ARM64</a>\n`
content += '\n<b>Windows7/8：</b>\n'
content += `安装版：<a href="${downloadUrl}/mihomo-party-win7-${version}-x64-setup.exe">64位</a> | <a href="${downloadUrl}/mihomo-party-win7-${version}-ia32-setup.exe">32位</a>\n`
content += `便携版：<a href="${downloadUrl}/mihomo-party-win7-${version}-x64-portable.7z">64位</a> | <a href="${downloadUrl}/mihomo-party-win7-${version}-ia32-portable.7z">32位</a>\n`
content += '\n<b>macOS 11+：</b>\n'
content += `PKG：<a href="${downloadUrl}/mihomo-party-macos-${version}-x64.pkg
">Intel</a> | <a href="${downloadUrl}/mihomo-party-macos-${version}-arm64.pkg">Apple Silicon</a>\n`
content += '\n<b>macOS 10.15+：</b>\n'
content += `PKG：<a href="${downloadUrl}/mihomo-party-catalina-${version}-x64.pkg
">Intel</a> | <a href="${downloadUrl}/mihomo-party-catalina-${version}-arm64.pkg">Apple Silicon</a>\n`
content += '\n<b>Linux：</b>\n'
content += `DEB：<a href="${downloadUrl}/mihomo-party-linux-${version}-amd64.deb
">64位</a> | <a href="${downloadUrl}/mihomo-party-linux-${version}-arm64.deb">ARM64</a>\n`
content += `RPM：<a href="${downloadUrl}/mihomo-party-linux-${version}-x86_64.rpm">64位</a> | <a href="${downloadUrl}/mihomo-party-linux-${version}-aarch64.rpm">ARM64</a>`

await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  chat_id,
  text: content,
  link_preview_options: {
    is_disabled: false,
    url: 'https://github.com/mihomo-party-org/mihomo-party',
    prefer_large_media: true
  },
  parse_mode: 'HTML'
})

console.log(`${isDevRelease ? '开发版本' : '正式版本'}Telegram 通知发送成功`)