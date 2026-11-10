import type { WebQQChatType, WebQQFriend, WebQQFriendCategory, WebQQGroup } from '../../types'
import {
  getNumberField,
  getStringField,
  isRecord,
  toArrayResult,
} from '../../../onebot/data'
import {
  resolveWebQQGroupAvatar,
  resolveWebQQUserAvatar,
  type WebQQAvatarScope,
} from '../../display'

// NapCat 与 LLBot 的联系人载荷里没有头像字段，头像按 QQ 号合成；提供方插件可以给出这些字段，
// 给了就用它的，避免把场景编号当成 QQ 号去腾讯 CDN 换一张陌生人的头像。
export const oneBotAvatarFields = ['avatar', 'avatarUrl', 'avatar_url', 'headUrl', 'head_url']

export function normalizeFriend(raw: unknown, scope: WebQQAvatarScope, category?: { id: string; name: string }): WebQQFriend {
  const item = isRecord(raw) ? raw : {}
  const userId = getStringField(item, ['user_id', 'uin', 'uid'])
  const nickname = getStringField(item, ['nickname', 'nick', 'name']) || userId
  const remark = getStringField(item, ['remark', 'card'])
  return {
    userId,
    name: remark || nickname,
    nickname,
    avatar: resolveWebQQUserAvatar(getStringField(item, oneBotAvatarFields), userId, scope),
    ...(category ? { categoryId: category.id, categoryName: category.name } : {}),
  }
}

export function normalizeFriendCategory(raw: unknown, index: number, scope: WebQQAvatarScope): WebQQFriendCategory {
  const item = isRecord(raw) ? raw : {}
  const id = getStringField(item, ['categoryId', 'category_id', 'id']) || String(index)
  const name = getStringField(item, ['categoryName', 'category_name', 'name']) || '未分组'
  const friends = toArrayResult(item, 'buddyList').map((friend) => normalizeFriend(friend, scope, { id, name }))
  return { id, name, friends }
}

export function normalizeGroup(raw: unknown, scope: WebQQAvatarScope): WebQQGroup {
  const item = isRecord(raw) ? raw : {}
  const groupId = getStringField(item, ['group_id', 'groupCode', 'group_id_str'])
  return {
    groupId,
    name: getStringField(item, ['group_name', 'groupName', 'name']) || groupId,
    memberCount: getNumberField(item, ['member_count', 'memberCount']),
    avatar: resolveWebQQGroupAvatar(getStringField(item, oneBotAvatarFields), groupId, scope),
  }
}

export function getRecentPeerType(raw: Record<string, unknown>, peerId: string, friends: WebQQFriend[], groups: WebQQGroup[]): WebQQChatType {
  const chatType = getStringField(raw, ['chatType', 'chat_type', 'type'])
  if (chatType === '2' || chatType === 'group') return 'group'
  if (chatType === '1' || chatType === 'friend' || chatType === 'private') return 'friend'
  if (groups.some((group) => group.groupId === peerId)) return 'group'
  return 'friend'
}
