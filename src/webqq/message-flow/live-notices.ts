import type { Session } from '@satorijs/core'
import type { WebQQLiveMessage } from '../types'
import { isRecord, readRecordText } from '../../shared/record'
import { readWebQQGroupMemberName } from '../adapters/onebot/group-sender-metadata'
import { resolveWebQQUserAvatar } from '../display'
import {
  readWebQQSessionAvatarScope,
  readWebQQSessionUserAvatar,
} from '../adapters/onebot/avatar-scope'
import { createWebQQEventMessage } from './live-message'
import { readWebQQPeer } from './session'

function readRawEventData(session: Session) {
  const data = (session.event as { _data?: unknown })._data
  return isRecord(data) ? data : {}
}

function readWebQQNoticePeer(session: Session) {
  const groupId = readRecordText(readRawEventData(session), ['group_id', 'groupId'])
  if (groupId) return { type: 'group' as const, peerId: groupId }
  return readWebQQPeer(session)
}

export function resolveWebQQPokePeer(input: {
  groupId?: string
  senderId: string
  targetId: string
  selfId: string
}) {
  if (input.groupId) return { type: 'group' as const, peerId: input.groupId }
  // 私聊戳一戳的 user_id 是发起者。Bot 主动戳好友时它等于 selfId，
  // 若按普通私聊 peer（session.userId）解析，会落到 Bot 自己，
  // 造出一个真实 QQ 里不存在的“自己和自己”会话。
  const peerId = [input.senderId, input.targetId].find((id) => id && id !== input.selfId) || ''
  if (!peerId) return
  return { type: 'friend' as const, peerId }
}

function readWebQQPrivatePokeName(session: Session, userId: string, fallbackName: string, genericName: string) {
  if (userId && userId === session.bot.selfId) return '你'
  return fallbackName && fallbackName !== userId && !/^\d+$/.test(fallbackName) ? fallbackName : genericName
}

function readSessionUserName(session: Session, fallbackId = '') {
  return session.event.member?.name || session.event.operator?.name || session.event.user?.name || session.author?.name || fallbackId || '有人'
}

function readSessionUserAvatar(session: Session, userId: string) {
  return resolveWebQQUserAvatar(readWebQQSessionUserAvatar(session), userId, readWebQQSessionAvatarScope(session))
}

async function readWebQQNoticeMemberName(session: Session, userId: string, fallbackName: string, genericName: string) {
  if (userId) {
    try {
      const name = await readWebQQGroupMemberName(session, userId, true)
      if (name) return name
    } catch {}
  }
  return fallbackName && fallbackName !== userId && !/^\d+$/.test(fallbackName) ? fallbackName : genericName
}

function formatMuteDuration(seconds: number) {
  if (!seconds) return ''
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时`
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`
  return `${seconds} 秒`
}

export function createWebQQNoticeRuntime(options: {
  broadcastWebQQLivePayload: (payload: WebQQLiveMessage) => void
}) {
  const recordWebQQNotice = async (session: Session | undefined) => {
    if (!session || (session.bot.platform || session.platform) !== 'onebot') return
    const data = readRawEventData(session)
    const noticeType = readRecordText(data, ['notice_type', 'noticeType'])
    const subType = readRecordText(data, ['sub_type', 'subType'])
    if (noticeType !== 'group_ban' && !(noticeType === 'notify' && subType === 'poke')) return
    if (noticeType === 'notify' && subType === 'poke') {
      // SnowLuma 私聊戳一戳的 user_id 是会话对象，发起者在 sender_id；其他实现两者相同或没有 sender_id。
      const senderId = readRecordText(data, ['sender_id', 'senderId', 'user_id', 'userId']) || session.userId || session.event.user?.id || ''
      const targetId = readRecordText(data, ['target_id', 'targetId']) || session.event.operator?.id || ''
      const peer = resolveWebQQPokePeer({
        groupId: readRecordText(data, ['group_id', 'groupId']),
        senderId,
        targetId,
        selfId: session.bot.selfId,
      })
      if (!peer) return
      const senderFallback = readRecordText(data, ['sender_nickname', 'senderNickname', 'user_name', 'userName']) || readSessionUserName(session, senderId)
      const targetFallback = readRecordText(data, ['target_nickname', 'targetNickname', 'target_name', 'targetName'])
      const senderName = peer.type === 'friend'
        ? readWebQQPrivatePokeName(session, senderId, senderFallback, '对方')
        : await readWebQQNoticeMemberName(session, senderId, senderFallback, '某成员')
      const targetName = peer.type === 'friend'
        ? readWebQQPrivatePokeName(session, targetId, targetFallback, '对方')
        : await readWebQQNoticeMemberName(session, targetId, targetFallback, '对方')
      options.broadcastWebQQLivePayload({
        ...peer,
        message: createWebQQEventMessage(peer, session.timestamp, 'poke', `${senderName} 戳了戳 ${targetName}`, senderId, readSessionUserName(session, senderId), readSessionUserAvatar(session, senderId)),
      })
      return
    }
    const peer = readWebQQNoticePeer(session)
    if (!peer) return
    if (noticeType === 'group_ban') {
      const operatorId = readRecordText(data, ['operator_id', 'operatorId']) || session.operatorId || session.event.operator?.id || ''
      const targetId = readRecordText(data, ['user_id', 'userId', 'target_id', 'targetId']) || session.userId || session.event.user?.id || ''
      const operatorName = await readWebQQNoticeMemberName(
        session,
        operatorId,
        readRecordText(data, ['operator_name', 'operatorName']) || session.event.operator?.name || '',
        '管理员',
      )
      const targetName = await readWebQQNoticeMemberName(
        session,
        targetId,
        readRecordText(data, ['user_name', 'userName', 'target_name', 'targetName']) || session.event.user?.name || '',
        '对方',
      )
      const duration = Number(data.duration) || 0
      const durationText = formatMuteDuration(duration)
      const summary = subType === 'lift_ban'
        ? `${operatorName} 解除了 ${targetName} 的禁言`
        : `${operatorName} 禁言了 ${targetName}${durationText ? ` ${durationText}` : ''}`
      options.broadcastWebQQLivePayload({
        ...peer,
        message: createWebQQEventMessage(peer, session.timestamp, 'mute', summary, operatorId, readSessionUserName(session, operatorId), readSessionUserAvatar(session, operatorId)),
      })
    }
  }

  return { recordWebQQNotice }
}
