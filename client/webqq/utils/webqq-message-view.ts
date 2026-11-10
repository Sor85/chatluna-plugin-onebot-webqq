import type { CapsuleSnapshot } from '../../../src/capsule/state/types'
import type { WebQQForwardItem, WebQQGroupMember, WebQQMessage } from '../types'
import type { WebQQChatSelection } from './webqq-contact-view'
import { tr } from '../../i18n'

export type WebQQMessageElement = WebQQMessage['elements'][number]
export type WebQQUsageMessage = WebQQMessage & { usage: NonNullable<WebQQMessage['usage']> }

export type WebQQElementRun =
  | { type: 'inline'; elements: WebQQMessageElement[] }
  | { type: 'block'; element: WebQQMessageElement }

export type WebQQThinkingMessage = WebQQMessage & { thinking: NonNullable<WebQQMessage['thinking']> }

export function getUnreadText(count: number) {
  return count > 9999 ? '9999+' : String(count)
}

export function getMessageKey(message: WebQQMessage) {
  return message.id || message.sequence || `${message.senderId}:${message.time}:${message.summary}`
}

function hasMessageContent(message: WebQQMessage) {
  return !!message.summary || message.elements.length > 0
}

export function mergeWebQQMessage(current: WebQQMessage | undefined, next: WebQQMessage) {
  if (!current) return next
  const merged = {
    ...current,
    ...next,
  }
  if (current.thinking || next.thinking) merged.thinking = next.thinking || current.thinking
  // thinking.usage 会接管展示；后补 think 时必须清掉临时 fallback usage，避免同一回复显示两份指标。
  if (next.thinking) delete merged.usage
  // 贴表情更新有时只带 reaction 状态，不带原消息正文；不能让它覆盖已缓存的撤回原文。
  if (hasMessageContent(current) && !hasMessageContent(next)) {
    merged.summary = current.summary
    merged.elements = current.elements
  }
  return merged
}

export function mergeMessages(currentMessages: WebQQMessage[], nextMessages: WebQQMessage[]) {
  const merged = new Map(currentMessages.map((item) => [getMessageKey(item), item]))
  for (const message of nextMessages) {
    const key = getMessageKey(message)
    merged.set(key, mergeWebQQMessage(merged.get(key), message))
  }
  return [...merged.values()].sort((a, b) => a.time - b.time)
}

export function isSameOutgoingClusterMessage(left: WebQQMessage | undefined, right: WebQQMessage | undefined) {
  return !!left &&
    !!right &&
    left.direction === 'outgoing' &&
    right.direction === 'outgoing' &&
    left.senderId === right.senderId
}

export function getLastOutgoingClusterThinkingMessage(messages: WebQQMessage[], index: number): WebQQThinkingMessage | undefined {
  const message = messages[index]
  if (!message || message.direction !== 'outgoing') return
  if (isSameOutgoingClusterMessage(message, messages[index + 1])) return
  for (let cursor = index; cursor >= 0; cursor--) {
    const candidate = messages[cursor]
    if (!candidate) break
    if (!isSameOutgoingClusterMessage(message, candidate)) break
    if (candidate.thinking?.content) return {
      ...candidate,
      thinking: candidate.thinking,
    }
  }
}

export function getLastOutgoingClusterUsageMessage(messages: WebQQMessage[], index: number): WebQQUsageMessage | undefined {
  const message = messages[index]
  if (!message || message.direction !== 'outgoing') return
  if (isSameOutgoingClusterMessage(message, messages[index + 1])) return
  let usageMessage: WebQQUsageMessage | undefined
  for (let cursor = index; cursor >= 0; cursor--) {
    const candidate = messages[cursor]
    if (!candidate) break
    if (!isSameOutgoingClusterMessage(message, candidate)) break
    if (candidate.thinking?.content) return
    if (!usageMessage && candidate.usage) usageMessage = {
      ...candidate,
      usage: candidate.usage,
    }
  }
  return usageMessage
}

export function hasOutgoingMessageAfter(messages: WebQQMessage[], timestamp: number) {
  return messages.some((message) => message.direction === 'outgoing' && message.time >= timestamp)
}

export function createBotThinkingMessage(capsule: CapsuleSnapshot | undefined, currentChat: WebQQChatSelection | undefined, messages: WebQQMessage[]) {
  const conversation = capsule?.conversation
  const bot = capsule?.bot
  if (!currentChat || !conversation || !bot || conversation.activityText !== '正在思考') return
  const peerId = currentChat.type === 'group'
    ? conversation.channelId
    : conversation.userId || conversation.channelId
  if (peerId !== currentChat.peerId) return
  if (hasOutgoingMessageAfter(messages, conversation.timestamp)) return
  const targetName = conversation.userName || currentChat.name
  return {
    id: `thinking:${currentChat.type}:${currentChat.peerId}:${conversation.timestamp}`,
    sequence: `thinking:${conversation.timestamp}`,
    time: conversation.timestamp,
    senderId: bot.selfId,
    senderName: bot.name || '机器人',
    senderAvatar: bot.avatar || (bot.selfId ? `https://q1.qlogo.cn/g?b=qq&nk=${bot.selfId}&s=640` : ''),
    senderRole: conversation.senderRole,
    senderLevel: conversation.senderLevel,
    senderTitle: conversation.senderTitle,
    direction: 'outgoing',
    summary: targetName ? `正在回复 ${targetName}` : '正在思考',
    elements: [{ type: 'unknown', text: '正在思考' }],
  } satisfies WebQQMessage
}

export function formatThinkingDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  return tr('webqq.thinking.duration', { seconds })
}

export function isInlineWebQQElement(element: WebQQMessageElement) {
  return element.type !== 'quote' && element.type !== 'image' && element.type !== 'forward' && element.type !== 'card' && element.type !== 'record'
}

export function getWebQQElementRuns(elements: WebQQMessageElement[]) {
  const runs: WebQQElementRun[] = []
  for (const element of elements) {
    if (!isInlineWebQQElement(element)) {
      runs.push({ type: 'block', element })
      continue
    }
    const last = runs.at(-1)
    if (last?.type === 'inline') {
      last.elements.push(element)
    } else {
      runs.push({ type: 'inline', elements: [element] })
    }
  }
  return runs
}

export function getForwardPreviewText(item: WebQQForwardItem) {
  return item.elements.map((element) => {
    if (element.type === 'text') return element.text
    if (element.type === 'image') return '[图片]'
    if (element.type === 'quote') return element.text || '[引用消息]'
    if (element.type === 'forward') return '[合并转发]'
    if (element.type === 'card') return element.title || element.text || '[卡片消息]'
    if (element.type === 'face') return element.text || '[表情]'
    if (element.type === 'record') return element.text || '[语音]'
    return element.text || '[消息]'
  }).filter(Boolean).join('') || '[消息]'
}

export function isImageOnlyMessage(message: WebQQMessage) {
  return message.elements.length === 1 &&
    message.elements[0].type === 'image' &&
    !!message.elements[0].url
}

export function getForwardItemName(item: WebQQForwardItem) {
  return item.title || item.senderId || 'QQ 用户'
}

export function getForwardItemAvatar(item: WebQQForwardItem, defaultAvatar: string) {
  return item.senderAvatar || defaultAvatar
}

export function getForwardPreviewItems(element: WebQQMessageElement, limit: number) {
  return element.items?.slice(0, limit) ?? []
}

function getForwardItemSenderKey(item: WebQQForwardItem | undefined) {
  return item ? item.senderId || item.title || '' : ''
}

function isSameForwardItemSender(left: WebQQForwardItem | undefined, right: WebQQForwardItem | undefined) {
  const leftKey = getForwardItemSenderKey(left)
  return !!leftKey && leftKey === getForwardItemSenderKey(right)
}

export function isMergedForwardItem(items: WebQQForwardItem[], index: number, chatStyle: string) {
  return chatStyle === 'tim' &&
    isSameForwardItemSender(items[index - 1], items[index])
}

export function getForwardItemClusterClass(items: WebQQForwardItem[], index: number, chatStyle: string) {
  if (chatStyle !== 'tim') return ''
  const hasPrevious = isSameForwardItemSender(items[index - 1], items[index])
  const hasNext = isSameForwardItemSender(items[index], items[index + 1])
  if (hasPrevious && hasNext) return 'is-cluster-middle'
  if (hasNext) return 'is-cluster-first'
  if (hasPrevious) return 'is-cluster-last'
  return ''
}

function getClusterBubbleMessage(messages: WebQQMessage[], index: number, step: 1 | -1) {
  const message = messages[index]
  if (!message) return
  for (let cursor = index + step; cursor >= 0 && cursor < messages.length; cursor += step) {
    const candidate = messages[cursor]
    if (
      !candidate ||
      candidate.senderId !== message.senderId ||
      candidate.direction !== message.direction
    ) return
    if (!isImageOnlyMessage(candidate)) return candidate
  }
}

export function isMergedMessage(messages: WebQQMessage[], index: number, chatStyle: string) {
  if (chatStyle !== 'tim') return false
  const message = messages[index]
  const previous = messages[index - 1]
  return !!message &&
    !!previous &&
    previous.senderId === message.senderId &&
    previous.direction === message.direction
}

export function getMessageClusterClass(messages: WebQQMessage[], index: number, chatStyle: string) {
  if (chatStyle !== 'tim') return ''
  const message = messages[index]
  if (!message) return ''
  const hasPrevious = !!getClusterBubbleMessage(messages, index, -1)
  const hasNext = !!getClusterBubbleMessage(messages, index, 1)
  if (hasPrevious && hasNext) return 'is-cluster-middle'
  if (hasNext) return 'is-cluster-first'
  if (hasPrevious) return 'is-cluster-last'
  return ''
}

export function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function padNoticeTimePart(value: number) {
  return String(value).padStart(2, '0')
}

export function formatNoticeTime(timestamp: number) {
  const date = new Date(timestamp)
  const month = padNoticeTimePart(date.getMonth() + 1)
  const day = padNoticeTimePart(date.getDate())
  const hour = padNoticeTimePart(date.getHours())
  const minute = padNoticeTimePart(date.getMinutes())
  return `${month}/${day} ${hour}:${minute}`
}

export function formatSenderLevel(level: string) {
  return level.startsWith('Lv.') ? level : `Lv.${level}`
}

export function getGroupMemberName(member: WebQQGroupMember) {
  return member.card || member.nickname || member.userId
}

export function getSenderAuthorityText(message: WebQQMessage) {
  return message.senderTitle || message.senderRole || ''
}

export function getSenderAuthorityClass(message: WebQQMessage) {
  if (message.senderRole === '群主') return 'is-owner'
  if (message.senderRole === '管理员') return 'is-admin'
  return 'is-title'
}
