// 历史默认 fake-ip-filter，用来识别“用户未修改过旧默认值”的场景。
export const legacyDefaultFakeIpFilter = [
  '*',
  '+.lan',
  '+.local',
  'time.*.com',
  'ntp.*.com',
  '+.market.xiaomi.com'
]

// 为微信/企业微信图片等资源补充直连解析域名，避免 TUN + fake-ip 下上传异常。
export const wechatFakeIpCompatDomains = [
  'mmbiz.qpic.cn',
  'wxaintpcos.wxqcloud.qq.com.cn',
  '+.qpic.cn',
  '+.wxqcloud.qq.com.cn',
  '+.servicewechat.com',
  '+.weixin.qq.com',
  '+.wxs.qq.com',
  '+.res.wx.qq.com',
  '+.wework.qpic.cn'
]

// 当前应用内置的默认 fake-ip-filter。
export const defaultFakeIpFilter = [
  ...legacyDefaultFakeIpFilter,
  ...wechatFakeIpCompatDomains
]
