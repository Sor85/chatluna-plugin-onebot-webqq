export function getWebQQUserAvatar(userId: string) {
  return userId ? `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640` : ''
}

export function getWebQQGroupAvatar(groupId: string) {
  return groupId ? `https://p.qlogo.cn/gh/${groupId}/${groupId}/640/` : ''
}

/**
 * 头像取值范围。
 *
 * 只有 id 确实是 QQ 号时才允许由 id 合成腾讯 CDN 地址。虚拟 OneBot 机器人的 id 是提供方场景里的
 * 编号，合成出来的地址会真的从腾讯拉回**同号真实用户**的头像，或者拉回 CDN 的默认群头像——
 * 两种都不是场景里的头像，而且会为一个本地模拟环境产生对外请求。
 */
export interface WebQQAvatarScope {
  synthesizeQQAvatars: boolean
}

// 能直接进 <img src> 的取值才算「对方给了头像」。提供方插件可能给的是它自己的媒体引用
// （例如受管媒体的 sandbox-media:// 之类），塞进 <img> 只会渲染成一张碎图，不如当作没有头像
// 交给界面的首字母占位。
const renderableWebQQAvatarPattern = /^(?:https?:\/\/|data:image\/|\/)/

export function readWebQQProvidedAvatar(value: unknown) {
  const avatar = typeof value === 'string' ? value.trim() : ''
  return renderableWebQQAvatarPattern.test(avatar) ? avatar : ''
}

export function resolveWebQQUserAvatar(provided: unknown, userId: string, scope: WebQQAvatarScope) {
  return readWebQQProvidedAvatar(provided) || (scope.synthesizeQQAvatars ? getWebQQUserAvatar(userId) : '')
}

export function resolveWebQQGroupAvatar(provided: unknown, groupId: string, scope: WebQQAvatarScope) {
  return readWebQQProvidedAvatar(provided) || (scope.synthesizeQQAvatars ? getWebQQGroupAvatar(groupId) : '')
}

export function normalizeWebQQGroupRole(role: string) {
  if (role === 'owner') return '群主'
  if (role === 'admin' || role === 'administrator') return '管理员'
  return ''
}

export function getWebQQGroupSubtitle(group: { groupId: string; memberCount: number }) {
  return `群聊 ${group.groupId} · ${group.memberCount} 人`
}
