import type { Session } from '@satorijs/core'
import type { WebQQNotice } from '../types'
import { isRecord, readRecordText } from '../../shared/record'
import { resolveWebQQGroupAvatar, resolveWebQQUserAvatar } from '../display'
import {
  readWebQQSessionAvatarScope,
  readWebQQSessionUserAvatar,
} from '../adapters/onebot/avatar-scope'
import { readUserName } from '../message-flow/session'

export function createWebQQFriendRequestNotice(session: Session): WebQQNotice | undefined {
  if ((session.bot.platform || session.platform) !== 'onebot') return
  const raw = isRecord(session.event) && isRecord(session.event._data) ? session.event._data : {}
  const requesterId = session.userId || session.event.user?.id
  const requesterName = readUserName(session) || requesterId
  if (!requesterId && !requesterName) return
  const flag = readRecordText(raw, ['flag', 'request_id', 'requestId'])
  const comment = readRecordText(raw, ['comment', 'message', 'reason'])
  const id = flag || requesterId || String(session.timestamp)
  return {
    id: `friend:${id}`,
    type: 'friend-request',
    title: requesterName || '好友申请',
    subtitle: requesterId ? `来自 QQ ${requesterId}` : '新的好友申请',
    avatar: resolveWebQQUserAvatar(readWebQQSessionUserAvatar(session), requesterId || '', readWebQQSessionAvatarScope(session)),
    status: 'pending',
    time: session.timestamp,
    ...(flag ? { flag } : {}),
    ...(requesterId ? { requesterId } : {}),
    ...(requesterName ? { requesterName } : {}),
    ...(comment ? { comment } : {}),
  }
}

export function createWebQQGroupLeaveNotice(session: Session): WebQQNotice | undefined {
  if ((session.bot.platform || session.platform) !== 'onebot') return
  const groupId = session.channelId || session.guildId || session.event.channel?.id || session.event.guild?.id
  const groupName = session.event.guild?.name || session.event.channel?.name || groupId
  const requesterId = session.userId || session.event.user?.id
  const requesterName = readUserName(session) || requesterId
  if (!groupId) return
  return {
    id: `group:leave:${groupId}:${requesterId || 'unknown'}:${session.timestamp}`,
    type: 'group-notice',
    title: groupName || '群通知',
    subtitle: requesterName ? `${requesterName} 退出群聊` : '成员退出群聊',
    avatar: resolveWebQQGroupAvatar(session.event.guild?.avatar, groupId, readWebQQSessionAvatarScope(session)),
    status: 'approved',
    time: session.timestamp,
    subType: 'leave',
    groupId,
    ...(groupName ? { groupName } : {}),
    ...(requesterId ? { requesterId } : {}),
    ...(requesterName ? { requesterName } : {}),
  }
}
