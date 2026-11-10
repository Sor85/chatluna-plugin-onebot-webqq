import type { WebQQMessage } from '../types'
import { getWebQQEmojiFace } from './emoji-catalog'
import { applyWebQQRecallToMessages } from './webqq-recall-view'

function isTargetMessage(message: WebQQMessage, messageId: string) {
  return message.id === messageId || message.sequence === messageId
}

function getWebQQReactionUserAvatar(userId: string) {
  return userId ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(userId)}&s=640` : ''
}

function getReactionUsers(reaction: NonNullable<WebQQMessage['reactions']>[number]) {
  if (reaction.users?.length) return reaction.users.slice()
  if (!reaction.userId) return []
  return [{
    userId: reaction.userId,
    userAvatar: reaction.userAvatar || getWebQQReactionUserAvatar(reaction.userId),
  }]
}

export function applyLocalWebQQReaction(
  messages: WebQQMessage[],
  messageId: string,
  emojiId: string,
  operatorId: string,
  enabled: boolean,
): WebQQMessage[] {
  return messages.map((message) => {
    if (!isTargetMessage(message, messageId)) return message
    const reactions = message.reactions?.map((reaction) => ({
      ...reaction,
      ...(reaction.users ? { users: reaction.users.slice() } : {}),
    })) ?? []
    const index = reactions.findIndex((reaction) => reaction.emojiId === emojiId)
    const current = index >= 0 ? reactions[index] : undefined
    const currentUsers = current ? getReactionUsers(current) : []
    const users = currentUsers.filter((user) => user.userId !== operatorId)

    if (enabled) {
      if (currentUsers.some((user) => user.userId === operatorId) || current?.userId === operatorId) return message
      const face = getWebQQEmojiFace(emojiId)
      const operatorAvatar = getWebQQReactionUserAvatar(operatorId)
      const nextUsers = operatorId
        ? [...users, { userId: operatorId, userAvatar: operatorAvatar }]
        : users
      const next = {
        emojiId,
        label: current?.label || face?.label || '[表情]',
        ...(current?.emojiUrl || face?.url ? { emojiUrl: current?.emojiUrl || face?.url } : {}),
        count: (current?.count ?? 0) + 1,
        userId: operatorId,
        userAvatar: operatorAvatar,
        users: nextUsers,
      }
      if (index >= 0) reactions[index] = next
      else reactions.push(next)
    } else {
      if (!current) return message
      const nextCount = Math.max(0, current.count - 1)
      if (!nextCount) reactions.splice(index, 1)
      else reactions[index] = {
        ...current,
        count: nextCount,
        ...(current.userId === operatorId ? { userId: undefined, userAvatar: undefined } : {}),
        users,
      }
    }
    return { ...message, reactions }
  })
}

export function applyLocalWebQQRecall(messages: WebQQMessage[], type: 'friend' | 'group', peerId: string, messageId: string) {
  return applyWebQQRecallToMessages(messages, { type, peerId, messageId, mode: 'mark' })
}
