import type { Session } from '@satorijs/core'
import type { WebQQMessage } from '../types'
import { isRecord, readRecordText } from '../../shared/record'
import { readWebQQSenderMetadata } from '../sender/sender-metadata'

export function readBotProfile(session: Session) {
  const user = session.bot.toJSON?.().user
  return {
    platform: session.bot.platform || session.platform || 'unknown',
    selfId: session.bot.selfId,
    status: session.bot.status,
    name: user?.name,
    avatar: user?.avatar,
  }
}

export function readChannelName(session: Session) {
  return session.event.guild?.name || session.event.channel?.name
}

export function readMemberName(session: Session) {
  return session.event.member?.name || session.event.member?.nick
}

export function readUserName(session: Session) {
  return readMemberName(session) || session.event.user?.name || session.author?.name
}

function readRawEventData(session: Pick<Session, 'event'>) {
  const data = (session.event as { _data?: unknown })._data
  return isRecord(data) ? data : {}
}

export function readWebQQPeer(session: Pick<Session, 'event' | 'guildId' | 'channelId' | 'userId'>) {
  const rawGroupId = readRecordText(readRawEventData(session), ['group_id', 'groupId'])
  const isGroup = !!(rawGroupId || session.guildId || session.event.guild)
  const channelId = session.channelId || session.event.channel?.id
  const directPeer = channelId?.startsWith('private:') ? channelId.slice('private:'.length) : undefined
  const peerId = isGroup
    // OneBot 的群号在原始 group_id；部分适配器会把 channelId 做成共享或合成值，
    // 用它做 WebQQ 会话 key 会把不同群的实时消息并到同一个会话。
    ? rawGroupId || session.guildId || session.event.guild?.id || session.channelId || session.event.channel?.id
    : directPeer || session.userId || session.event.user?.id || channelId
  if (!peerId) return
  return {
    type: isGroup ? 'group' as const : 'friend' as const,
    peerId,
  }
}

export function readWebQQLiveDirection(session: Session): WebQQMessage['direction'] {
  const senderId = session.userId || session.event.user?.id
  return senderId && senderId === session.bot.selfId ? 'outgoing' : 'incoming'
}

export function readWebQQLiveSenderMetadata(session: Session) {
  return readWebQQSenderMetadata(session.event.member)
}
