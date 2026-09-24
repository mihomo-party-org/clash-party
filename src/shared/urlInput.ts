// URL 输入归一化：中文 IME 手输时常见全角标点/字母数字（：/．＃？＝ 等）混入，
// 肉眼与半角几乎一致，但 new URL() 会抛 "Invalid URL"，而复制粘贴（半角）却能成功，
// 表现为「同一链接手打失败、粘贴成功」（#756）。在入口统一转半角并去首尾空白。
export function normalizeUrlInput(raw: string): string {
  return raw
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .trim()
}
