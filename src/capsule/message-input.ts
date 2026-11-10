import type { Session } from '@satorijs/core'
import { readRecordText } from '../shared/record'

export interface ChatLunaMessage {
  id?: string
  name?: string
}

export function readCapsuleBotProfile(session: Session) {
  const user = session.bot.toJSON?.().user
  return {
    platform: session.bot.platform || session.platform || 'unknown',
    selfId: session.bot.selfId,
    status: session.bot.status,
    name: user?.name,
    avatar: user?.avatar,
  }
}

function readCapsuleChannelName(session: Session) {
  return session.event.guild?.name || session.event.channel?.name
}

export function readCapsuleMemberName(session: Session) {
  return session.event.member?.name || session.event.member?.nick
}

function readCapsuleUserName(session: Session) {
  return readCapsuleMemberName(session) || session.event.user?.name || session.author?.name
}

function normalizeCapsuleGroupRole(role: string) {
  if (role === 'owner') return '群主'
  if (role === 'admin' || role === 'administrator') return '管理员'
  return ''
}

function readCapsuleSenderMetadata(session: Session) {
  const source = session.event.member
  const role = normalizeCapsuleGroupRole(readRecordText(source, ['role']))
  const senderLevel = readRecordText(source, ['level', 'sender_level', 'senderLevel'])
  const senderTitle = readRecordText(source, ['title', 'special_title', 'specialTitle'])
  return {
    ...(role ? { senderRole: role } : {}),
    ...(senderLevel ? { senderLevel } : {}),
    ...(senderTitle ? { senderTitle } : {}),
  }
}

export function createMessageInput(session: Session, message?: ChatLunaMessage) {
  const senderMetadata = readCapsuleSenderMetadata(session)
  return {
    bot: readCapsuleBotProfile(session),
    channel: {
      id: session.channelId || session.event.channel?.id || 'unknown',
      name: readCapsuleChannelName(session),
    },
    user: {
      id: message?.id || session.userId || session.event.user?.id || 'unknown',
      name: message?.name || readCapsuleUserName(session),
      ...senderMetadata,
    },
    timestamp: session.timestamp,
  }
}
