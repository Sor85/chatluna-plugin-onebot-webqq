import * as qface from 'qface'
import type { DebugLogger } from '../../shared/logger'
import type { WebQQLiveMessage, WebQQMessage, WebQQMessageReaction, WebQQMessageReactionUser } from '../types'
import type { WebQQRawReaction } from '../adapters/onebot/reactions'
import { isRecord } from '../../shared/record'
import { applyWebQQReactionToLiveMessages, getWebQQLiveMessageKey } from './live-cache'
import { createWebQQEventMessage } from './live-message'
import { resolveWebQQUserAvatar, type WebQQAvatarScope } from '../display'

interface WebQQReactionService {
  isAvailableSelectedSelfId(selfId?: string): boolean
  supportsReactionUsers(selfId?: string): boolean
  loadReactionUsers(messageId: string, emojiId: string, count: number, selfId?: string): Promise<WebQQMessageReactionUser[]>
  resolveMessage(id: string, selfId?: string): Promise<WebQQMessage>
}

// QQ 表情贴上报的 emoji_id 多为数字 ID，用 qface 转成可读名（如「赞」）；
// 取不到时回退原值（unicode emoji 可直接显示，纯数字 ID 兜底为 [表情]）。
function readWebQQReactionLabel(emojiId: string) {
  const name = qface.get(emojiId)?.QDes?.replace(/^\//, '')
  if (name) return name
  return /^\d+$/.test(emojiId) ? '[表情]' : emojiId
}

const QFACE_BASE = 'https://koishi.js.org/QFace'
const qqEmojiUrlCache = new Map<string, string>()
let qqEmojiIndexLoaded = false

async function loadQQEmojiIndex() {
  if (qqEmojiIndexLoaded) return
  qqEmojiIndexLoaded = true
  try {
    const res = await fetch(`${QFACE_BASE}/assets/qq_emoji/_index.json`)
    if (!res.ok) return
    const list: unknown[] = await res.json()
    for (const item of list) {
      if (!isRecord(item)) continue
      const id = String(item.emojiId ?? '')
      if (!id) continue
      const assets = Array.isArray(item.assets) ? item.assets : []
      const asset = assets.find((a: unknown) => isRecord(a) && a.type === 2) ?? assets.find((a: unknown) => isRecord(a) && a.type === 0)
      if (!asset || !isRecord(asset) || !asset.path) continue
      const url = `${QFACE_BASE}/${asset.path}`
      qqEmojiUrlCache.set(id, url)
      // 同时以 qcid（decimal codepoint）为 key，对应 OneBot 上报的数字形 Unicode emoji ID
      if (typeof item.qcid === 'number' && item.qcid > 0) qqEmojiUrlCache.set(String(item.qcid), url)
    }
  } catch { /* ignore */ }
}

function readWebQQReactionEmojiUrl(emojiId: string) {
  return qqEmojiUrlCache.get(emojiId) ?? ''
}

function getReactionTargetIds(reaction: WebQQRawReaction) {
  return [reaction.messageSeq, reaction.messageId].filter((id, index, array): id is string => !!id && array.indexOf(id) === index)
}

function getKnownReactionUserCount(messages: WebQQMessage[], targetIds: string[], reaction: WebQQRawReaction) {
  const userIds = new Set<string>()
  for (const message of messages) {
    if (!targetIds.includes(message.id) && !targetIds.includes(message.sequence)) continue
    const current = message.reactions?.find((item) => item.emojiId === reaction.emojiId)
    if (current?.userId) userIds.add(current.userId)
    for (const user of current?.users ?? []) userIds.add(user.userId)
  }
  if (reaction.userId) {
    if (reaction.isAdd) userIds.add(reaction.userId)
    else userIds.delete(reaction.userId)
  }
  return userIds.size
}

function applyWebQQReaction(messages: WebQQMessage[], targetIds: string[], entry: WebQQMessageReaction, isAdd: boolean) {
  for (const targetId of targetIds) {
    const nextMessages = applyWebQQReactionToLiveMessages(messages, targetId, entry, isAdd)
    if (!nextMessages) continue
    const message = nextMessages.find((item) => item.id === targetId || item.sequence === targetId)
    if (message) return { messages: nextMessages, message }
  }
}

export function createWebQQReactionRuntime(options: {
  liveMessages: Map<string, WebQQMessage[]>
  webqq: WebQQReactionService
  // 贴表情走原始 WS 事件，拿不到 session；头像取值范围只能由装配层传入。
  avatarScope: WebQQAvatarScope
  logger?: DebugLogger
  broadcastWebQQLivePayload: (payload: WebQQLiveMessage) => void
  rememberLiveMessages: (key: string, messages: WebQQMessage[]) => void
}) {
  loadQQEmojiIndex()

  const shouldResolveWebQQReactionUsers = (reaction: WebQQRawReaction, targetIds: string[]) => {
    if (reaction.count <= 0 || !reaction.messageId) return false
    if (!options.webqq.supportsReactionUsers(reaction.selfId)) return false
    const key = getWebQQLiveMessageKey({ type: 'group', peerId: reaction.groupId })
    const knownUserCount = getKnownReactionUserCount(options.liveMessages.get(key) ?? [], targetIds, reaction)
    return knownUserCount < reaction.count
  }

  const resolveWebQQReactionUsers = async (reaction: WebQQRawReaction, entry: WebQQMessageReaction) => {
    try {
      // `group_msg_emoji_like` 只带本次操作者和总数；人数更多时要拉完整列表，
      // 否则 TIM 风格只能显示一个头像再跟 count，无法展示所有贴表情用户。
      const users = await options.webqq.loadReactionUsers(reaction.messageId, reaction.emojiId, reaction.count, reaction.selfId)
      const nextUsers = users.map((user) => {
        // 同一个操作者在事件里已有稳定的 OneBot user_id 头像，避免被补查列表里的临时 headUrl 覆盖。
        if (!entry.userId || user.userId !== entry.userId || !entry.userAvatar) return user
        return { ...user, userAvatar: entry.userAvatar }
      })
      return nextUsers.length ? { ...entry, users: nextUsers } : entry
    } catch (error) {
      options.logger?.info('webqq reaction users resolve failed %s', error instanceof Error ? error.message : String(error))
      return entry
    }
  }

  const recordWebQQReaction = async (reaction: WebQQRawReaction) => {
    if (!options.webqq.isAvailableSelectedSelfId(reaction.selfId)) return
    const peer = { type: 'group' as const, peerId: reaction.groupId }
    const label = readWebQQReactionLabel(reaction.emojiId)
    const emojiUrl = readWebQQReactionEmojiUrl(reaction.emojiId)
    const userAvatar = reaction.userId ? resolveWebQQUserAvatar('', reaction.userId, options.avatarScope) : ''
    const entry: WebQQMessageReaction = {
      emojiId: reaction.emojiId,
      label,
      ...(emojiUrl ? { emojiUrl } : {}),
      count: reaction.count,
      ...(reaction.userId ? {
        userId: reaction.userId,
        userAvatar,
      } : {}),
    }
    const targetIds = getReactionTargetIds(reaction)
    const entryWithUsers = shouldResolveWebQQReactionUsers(reaction, targetIds)
      ? await resolveWebQQReactionUsers(reaction, entry)
      : entry
    // 补查期间可能切换 Bot 或断线，提交前再次验证来源，避免旧 Socket 污染当前会话。
    if (!options.webqq.isAvailableSelectedSelfId(reaction.selfId)) return
    const key = getWebQQLiveMessageKey(peer)
    // loadReactionUsers 上面可能 await；写回前必须重新读取 live cache，避免用旧快照覆盖期间到达的消息。
    const applied = applyWebQQReaction(options.liveMessages.get(key) ?? [], targetIds, entryWithUsers, reaction.isAdd)
    if (applied) {
      options.rememberLiveMessages(key, applied.messages)
      options.broadcastWebQQLivePayload({ ...peer, message: applied.message })
      return
    }
    // 目标消息可能是前端已加载的历史消息，而不是后端 live cache 中的实时消息。
    // OneBot reaction 只有短 message_id 时，拉一次 get_msg 得到同一条消息和 message_seq，
    // 再广播带 reaction 的原消息，让前端用正常消息合并逻辑更新气泡。
    try {
      const targetMessage = await options.webqq.resolveMessage(reaction.messageId, reaction.selfId)
      if (!options.webqq.isAvailableSelectedSelfId(reaction.selfId)) return
      const targetApplied = applyWebQQReaction(
        [targetMessage],
        [...targetIds, targetMessage.id, targetMessage.sequence],
        entryWithUsers,
        reaction.isAdd,
      )
      if (targetApplied) {
        options.broadcastWebQQLivePayload({ ...peer, message: targetApplied.message })
      }
      return
    } catch (error) {
      options.logger?.info('webqq reaction target resolve failed %s', error instanceof Error ? error.message : String(error))
    }
    if (!options.webqq.isAvailableSelectedSelfId(reaction.selfId)) return
    if (!reaction.isAdd) return
    const senderName = reaction.userId || '有人'
    const summary = `${senderName} 给一条消息贴了 ${label}`
    const time = Date.now()
    options.broadcastWebQQLivePayload({
      ...peer,
      message: createWebQQEventMessage(peer, time, 'reaction', summary, reaction.userId, senderName, resolveWebQQUserAvatar('', reaction.userId, options.avatarScope), reaction.messageId),
    })
  }

  return { recordWebQQReaction }
}
