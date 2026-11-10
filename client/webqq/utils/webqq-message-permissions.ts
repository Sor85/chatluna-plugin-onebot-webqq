import type { WebQQChatType, WebQQGroupMember, WebQQMessage } from '../types'

type WebQQGroupRole = NonNullable<WebQQGroupMember['rawRole']>

function getWebQQGroupRole(member: WebQQGroupMember | undefined): WebQQGroupRole | undefined {
  if (!member) return
  if (member.rawRole) return member.rawRole
  if (member.role === 'owner' || member.role === '群主') return 'owner'
  if (member.role === 'admin' || member.role === 'administrator' || member.role === '管理员') return 'admin'
  return 'member'
}

export function canReactToWebQQMessage(
  message: WebQQMessage,
  chatType: WebQQChatType | '',
  operatorId: string,
) {
  return !!chatType && !!operatorId && !message.event && !message.recalled && !!message.id
}

export function canRecallWebQQMessage(
  message: WebQQMessage,
  chatType: WebQQChatType | '',
  operatorId: string,
  groupMembers: WebQQGroupMember[],
) {
  if (!operatorId || message.event || message.recalled || !message.id) return false
  if (message.direction === 'outgoing' || message.senderId === operatorId) return true
  if (chatType !== 'group') return false

  const actorRole = getWebQQGroupRole(groupMembers.find((member) => member.userId === operatorId))
  const targetRole = getWebQQGroupRole(groupMembers.find((member) => member.userId === message.senderId))
  if (!actorRole || !targetRole || actorRole === 'member') return false

  // QQ 的管理层级不允许管理员越级撤回群主或其他管理员；群主则可以撤回管理员和普通成员。
  return targetRole !== 'owner' && !(actorRole === 'admin' && targetRole === 'admin')
}
