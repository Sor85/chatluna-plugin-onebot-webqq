import type { WebQQMessage, WebQQMessageQuery, WebQQMessageReaction, WebQQRecallPayload } from '../types'

type WebQQLiveMessageKeyInput = Pick<WebQQMessageQuery, 'type' | 'peerId'>

export function getWebQQLiveMessageKey(query: WebQQLiveMessageKeyInput) {
  return `${query.type}:${query.peerId}`
}

function getMessageKey(message: WebQQMessage) {
  return message.id || message.sequence || `${message.senderId}:${message.time}:${message.summary}`
}

function hasMessageContent(message: WebQQMessage) {
  return !!message.summary || message.elements.length > 0
}

function mergeWebQQLiveMessage(current: WebQQMessage | undefined, next: WebQQMessage) {
  if (!current) return next
  const merged = { ...current, ...next }
  // thinking.usage 会接管展示；后补 think 时必须清掉临时 fallback usage，避免同一回复显示两份指标。
  if (next.thinking) delete merged.usage
  // 贴表情事件可能只补 reactions，不带原消息正文；保留旧正文可避免撤回缓存重启后只剩表情。
  if (hasMessageContent(current) && !hasMessageContent(next)) {
    merged.summary = current.summary
    merged.elements = current.elements
  }
  return merged
}

function isMessageTarget(message: WebQQMessage, messageId: string) {
  return message.id === messageId || message.sequence === messageId
}

function getReactionUsers(reaction: WebQQMessageReaction) {
  if (reaction.users?.length) return reaction.users
  return reaction.userId && reaction.userAvatar
    ? [{ userId: reaction.userId, userAvatar: reaction.userAvatar }]
    : []
}

function mergeReactionUsers(current: WebQQMessageReaction | undefined, reaction: WebQQMessageReaction, isAdd: boolean) {
  if (reaction.users?.length) return reaction.count > 0 ? reaction.users.slice(-reaction.count) : []
  const user = reaction.userId && reaction.userAvatar
    ? { userId: reaction.userId, userAvatar: reaction.userAvatar }
    : undefined
  if (!user) return getReactionUsers(current ?? reaction)

  const users = getReactionUsers(current ?? reaction).filter((item) => item.userId !== user.userId)
  const nextUsers = isAdd ? [...users, user] : users
  return reaction.count > 0 ? nextUsers.slice(-reaction.count) : []
}

export function mergeWebQQLiveMessages(history: WebQQMessage[], live: WebQQMessage[] = [], limit?: number) {
  const messages = new Map<string, WebQQMessage>()
  for (const message of [...history, ...live]) {
    const key = getMessageKey(message)
    messages.set(key, mergeWebQQLiveMessage(messages.get(key), message))
  }
  const merged = [...messages.values()].sort((a, b) => a.time - b.time)
  return limit ? merged.slice(-limit) : merged
}

// 贴表情事件的 count 是该表情的全量人数，因此直接覆盖；is_add 为 false（取消）
// 或 count 归零时移除该表情，移空后清掉 reactions 字段避免渲染空容器。
export function applyWebQQReactionToLiveMessages(messages: WebQQMessage[], messageId: string, reaction: WebQQMessageReaction, isAdd: boolean) {
  let matched = false
  const nextMessages = messages.map((message) => {
    if (!isMessageTarget(message, messageId)) return message
    matched = true
    const reactions = message.reactions?.slice() ?? []
    const index = reactions.findIndex((item) => item.emojiId === reaction.emojiId)
    if (reaction.count <= 0) {
      if (index >= 0) reactions.splice(index, 1)
    } else if (index >= 0) {
      reactions[index] = {
        ...reactions[index],
        ...reaction,
        label: reaction.label || reactions[index].label,
        users: mergeReactionUsers(reactions[index], reaction, isAdd),
      }
    } else {
      reactions.push({
        ...reaction,
        users: mergeReactionUsers(undefined, reaction, isAdd),
      })
    }
    const next: WebQQMessage = { ...message, reactions }
    if (!reactions.length) delete next.reactions
    return next
  })
  return matched ? nextMessages : undefined
}

export function applyWebQQRecallToLiveMessages(messages: WebQQMessage[], payload: WebQQRecallPayload, limit?: number) {
  if (payload.mode === 'mark') {
    return messages.map((message) => isMessageTarget(message, payload.messageId)
      ? { ...message, recalled: true }
      : message)
  }
  const nextMessages = messages.filter((message) => !isMessageTarget(message, payload.messageId))
  return payload.eventMessage
    ? mergeWebQQLiveMessages(nextMessages, [payload.eventMessage], limit)
    : nextMessages
}
