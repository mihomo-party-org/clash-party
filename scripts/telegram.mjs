import axios from 'axios'
import { readFileSync } from 'fs'
import { getProcessedVersion, isDevBuild, getDownloadUrl, generateDownloadLinksMarkdown, getGitCommitHash } from './version-utils.mjs'

const chat_id = '@MihomoPartyChannel'
const pkg = readFileSync('package.json', 'utf-8')
const changelog = readFileSync('changelog.md', 'utf-8')
const { version: packageVersion } = JSON.parse(pkg)

// 获取处理后的版本号
const version = getProcessedVersion()
const releaseType = process.env.RELEASE_TYPE || process.argv[2] || 'release'
const isDevRelease = releaseType === 'dev' || isDevBuild()

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
  // 版本号中提取commit hash
  const shortCommitSha = getGitCommitHash(true)
  const commitSha = getGitCommitHash(false)
  
  content = `<b>🚧 <a href="https://github.com/mihomo-party-org/clash-party/releases/tag/dev">Clash Party Dev Build</a> 开发版本发布</b>\n\n`
  content += `<b>基于版本:</b> ${version}\n`
  content += `<b>提交哈希:</b> <a href="https://github.com/mihomo-party-org/clash-party/commit/${commitSha}">${shortCommitSha}</a>\n\n`
  content += `<b>更新日志:</b>\n`
  content += convertMarkdownToTelegramHTML(changelog)
  content += '\n\n<b>⚠️ 注意：这是开发版本，可能存在不稳定性，仅供测试使用</b>\n'
} else {
  // 正式版本通知
  content = `<b>🌟 <a href="https://github.com/mihomo-party-org/clash-party/releases/tag/v${version}">Clash Party v${version}</a> 正式发布</b>\n\n`
  content += convertMarkdownToTelegramHTML(changelog)
}

// 构建下载链接
const downloadUrl = getDownloadUrl(isDevRelease, version)

const downloadLinksMarkdown = generateDownloadLinksMarkdown(downloadUrl, version)
content += convertMarkdownToTelegramHTML(downloadLinksMarkdown)

await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  chat_id,
  text: content,
  link_preview_options: {
    is_disabled: false,
    url: 'https://github.com/mihomo-party-org/clash-party',
    prefer_large_media: true
  },
  parse_mode: 'HTML'
})

console.log(`${isDevRelease ? '开发版本' : '正式版本'}Telegram 通知发送成功`)