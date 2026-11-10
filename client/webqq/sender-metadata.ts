import type { WebQQMessage } from './types'

type WebQQChatType = 'friend' | 'group'

export type WebQQSenderMetadataCache = Record<string, Pick<WebQQMessage, 'senderRole' | 'senderLevel' | 'senderTitle'>>

function getSenderMetadataKey(type: WebQQChatType, peerId: string, senderId: string) {
  return `${type}:${peerId}:${senderId}`
}

function readSenderMetadata(message: WebQQMessage) {
  return {
    ...(message.senderRole ? { senderRole: message.senderRole } : {}),
    ...(message.senderLevel ? { senderLevel: message.senderLevel } : {}),
    ...(message.senderTitle ? { senderTitle: message.senderTitle } : {}),
  }
}

function hasSenderMetadata(metadata: Pick<WebQQMessage, 'senderRole' | 'senderLevel' | 'senderTitle'>) {
  return !!(metadata.senderRole || metadata.senderLevel || metadata.senderTitle)
}

function isSameSenderMetadata(
  left: Pick<WebQQMessage, 'senderRole' | 'senderLevel' | 'senderTitle'> | undefined,
  right: Pick<WebQQMessage, 'senderRole' | 'senderLevel' | 'senderTitle'>,
) {
  return !!left &&
    left.senderRole === right.senderRole &&
    left.senderLevel === right.senderLevel &&
    left.senderTitle === right.senderTitle
}

// 记录同一会话内每个发送者最近一次可见的群身份信息。
export function rememberWebQQSenderMetadata(
  cache: WebQQSenderMetadataCache,
  type: WebQQChatType,
  peerId: string,
  messages: WebQQMessage[],
) {
  let next = cache
  for (const message of messages) {
    if (!message.senderId) continue
    const metadata = readSenderMetadata(message)
    if (!hasSenderMetadata(metadata)) continue
    const key = getSenderMetadataKey(type, peerId, message.senderId)
    if (isSameSenderMetadata(next[key], metadata)) continue
    if (next === cache) next = { ...cache }
    next[key] = metadata
  }
  return next
}

// 用缓存补齐消息缺失的群身份信息，保留消息自身已有字段。
export function applyCachedWebQQSenderMetadata(
  cache: WebQQSenderMetadataCache,
  type: WebQQChatType,
  peerId: string,
  message: WebQQMessage,
) {
  const metadata = cache[getSenderMetadataKey(type, peerId, message.senderId)]
  if (!metadata) return message
  const next = { ...message }
  let changed = false
  if (!next.senderRole && metadata.senderRole) {
    next.senderRole = metadata.senderRole
    changed = true
  }
  if (!next.senderLevel && metadata.senderLevel) {
    next.senderLevel = metadata.senderLevel
    changed = true
  }
  if (!next.senderTitle && metadata.senderTitle) {
    next.senderTitle = metadata.senderTitle
    changed = true
  }
  return changed ? next : message
}
