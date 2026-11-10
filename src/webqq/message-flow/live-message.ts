import type { Session } from '@satorijs/core'
import type { WebQQChatType, WebQQLiveMessage, WebQQMessage } from '../types'
import { isRecord, readRecordText } from '../../shared/record'
import {
  normalizeLiveElements,
  summarizeWebQQElements,
  type WebQQForwardResolver,
  type WebQQImageResolver,
  type WebQQQuoteResolver,
  type WebQQRecordResolver,
} from './live-elements'
import {
  readBotProfile,
  readMemberName,
  readUserName,
  readWebQQPeer,
  readWebQQLiveSenderMetadata,
} from './session'
import { resolveWebQQUserAvatar } from '../display'
import {
  readWebQQSessionAvatarScope,
  readWebQQSessionUserAvatar,
} from '../adapters/onebot/avatar-scope'

function readRawMessageData(session: Session) {
  const data = (session.event as { _data?: unknown })._data
  return isRecord(data) ? data : {}
}

export type WebQQEventPeer = { type: WebQQChatType; peerId: string }

export function createWebQQEventMessage(
  peer: WebQQEventPeer,
  time: number,
  type: NonNullable<WebQQMessage['event']>['type'],
  summary: string,
  senderId: string,
  senderName: string,
  senderAvatar: string,
  targetMessageId?: string,
): WebQQMessage {
  return {
    id: `${type}:${peer.type}:${peer.peerId}:${time}:${senderId}:${targetMessageId || ''}`,
    sequence: `${type}:${time}:${targetMessageId || senderId}`,
    time,
    senderId,
    senderName,
    senderAvatar,
    direction: 'incoming',
    summary,
    event: {
      type,
      ...(targetMessageId ? { targetMessageId } : {}),
    },
    elements: [{ type: 'unknown', text: summary }],
  }
}

export async function createWebQQLiveMessage(
  session: Session,
  direction: WebQQMessage['direction'],
  resolveImage?: WebQQImageResolver,
  resolveQuote?: WebQQQuoteResolver,
  resolveForward?: WebQQForwardResolver,
  resolveRecord?: WebQQRecordResolver,
): Promise<WebQQLiveMessage | undefined> {
  if ((session.bot.platform || session.platform) !== 'onebot') return
  const peer = readWebQQPeer(session)
  if (!peer) return
  if (!(session.elements ?? session.event.message?.elements)?.length && !session.quote && !session.event.message?.quote && !session.content?.trim()) return
  const bot = readBotProfile(session)
  const elements = await normalizeLiveElements(session, resolveImage, resolveQuote, resolveForward, resolveRecord)
  const senderId = direction === 'outgoing'
    ? bot.selfId
    : session.userId || session.event.user?.id || 'unknown'
  const senderName = direction === 'outgoing'
    ? readMemberName(session) || bot.name || '机器人'
    : readUserName(session) || senderId
  // Koishi 的 session.messageId 可能是适配器二次包装后的 ID；WebQQ 和贴表情事件需要
  // OneBot 原始 message_id / message_seq 才能和历史消息、reaction 事件对齐。
  const rawData = readRawMessageData(session)
  const rawMessageId = readRecordText(rawData, ['message_id', 'messageId', 'msg_id', 'msgId'])
  const rawMessageSeq = readRecordText(rawData, ['message_seq', 'messageSeq', 'msg_seq', 'msgSeq', 'seq'])
  const id = rawMessageId || session.messageId || session.event.message?.id || `${direction}:${peer.type}:${peer.peerId}:${session.timestamp}`
  return {
    ...peer,
    message: {
      id,
      sequence: rawMessageSeq || session.messageId || session.event.message?.id || String(session.timestamp),
      time: session.timestamp,
      senderId,
      senderName,
      // 事件里带的头像优先：虚拟机器人场景里的头像只会从这里来。
      senderAvatar: resolveWebQQUserAvatar(
        readWebQQSessionUserAvatar(session),
        senderId,
        readWebQQSessionAvatarScope(session),
      ),
      ...readWebQQLiveSenderMetadata(session),
      direction,
      summary: summarizeWebQQElements(elements),
      elements,
    },
  }
}
