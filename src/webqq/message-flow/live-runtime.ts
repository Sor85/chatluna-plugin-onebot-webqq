import type { Session } from '@satorijs/core'
import type { OneBotBotScope } from '../../onebot/bots'
import { isVisibleBotSession } from '../../onebot/session'
import type { Config as PluginConfig } from '../../config/schema'
import { readConfigValue } from '../../config/spec'
import type { WebQQService } from '../adapters/types'
import type { WebQQChatType, WebQQLiveMessage, WebQQMessage, WebQQRecallPayload } from '../types'
import type { DebugLogger } from '../../shared/logger'
import type { WebQQAffinityReader } from '../affinity'
import type { WebQQTurnResult, WebQQTurnTarget } from '../../chatluna/turns'
import { applyWebQQRecallToLiveMessages, getWebQQLiveMessageKey, mergeWebQQLiveMessages } from './live-cache'
import { createWebQQLiveMessage, type WebQQEventPeer } from './live-message'
import type { WebQQImageUrlResolver } from '../media/image-url-resolver'
import {
  readWebQQPeer,
  readWebQQLiveDirection,
} from './session'
import { resolveWebQQUserAvatar } from '../display'
import {
  readWebQQSessionAvatarScope,
  readWebQQSessionUserAvatar,
} from '../adapters/onebot/avatar-scope'
import {
  readWebQQGroupSenderMetadata,
} from '../adapters/onebot/group-sender-metadata'
import {
  fillWebQQMessageSenderMetadata,
  hasWebQQSenderMetadata,
  isSameWebQQSenderMetadata,
  readWebQQMessageSenderMetadata,
  replaceWebQQMessageSenderMetadata,
  type WebQQSenderMetadata,
} from '../sender/sender-metadata'
import {
  loadDatabaseWebQQRecalledMessageCache,
  saveDatabaseWebQQRecalledMessageCache,
} from '../storage/recall-cache'
import type { WebQQStorageContext } from '../storage/schema'
import { createWebQQNoticeRuntime } from './live-notices'
import { createWebQQReactionRuntime } from './live-reactions'

type WebQQReplyPatch = Pick<WebQQMessage, 'thinking' | 'usage'>
const WEBQQ_LIVE_CONVERSATION_LIMIT = 100
const WEBQQ_LIVE_SENDER_METADATA_LIMIT = 1000

export type WebQQLiveRuntime = ReturnType<typeof createWebQQLiveRuntime>

function readRawRecallMessageId(session: Session) {
  const data = (session.event as { _data?: Record<string, unknown> })._data
  const value = data?.message_id ?? data?.messageId ?? data?.msg_id ?? data?.msgId
  return value == null ? '' : String(value)
}

/** 回合所在会话对应的 WebQQ peer：有触发消息就按消息解析，唤醒回合按 adapter-onebot 的 channelId 格式解析。 */
function readTurnPeer(target: WebQQTurnTarget): WebQQEventPeer | undefined {
  if (target.session) return readWebQQPeer(target.session)
  if (target.channelId.startsWith('private:')) return { type: 'friend', peerId: target.channelId.slice('private:'.length) }
  return { type: 'group', peerId: target.channelId }
}

export function createWebQQLiveRuntime(options: {
  storage: WebQQStorageContext
  config: PluginConfig
  webqq: WebQQService
  botScope: OneBotBotScope
  imageUrlResolver: WebQQImageUrlResolver
  logger?: DebugLogger
  attachAffinity: WebQQAffinityReader
  getStorageScope: () => string | undefined
  emitMessage: (payload: WebQQLiveMessage) => void
  emitRecall: (payload: WebQQRecallPayload) => void
}) {
  const liveMessages = new Map<string, WebQQMessage[]>()
  const liveSenderMetadata = new Map<string, WebQQSenderMetadata>()
  /** 进行中的 ChatLuna 回合：peer → 本轮已发出的回复 ID。 */
  const activeTurns = new Map<string, string[]>()
  /** 回合已结束、回复还没发出时挂起的思考与用量；之后这个会话发出的第一条机器人消息接手。 */
  const pendingReplyPatches = new Map<string, WebQQReplyPatch>()

  function isSelectedWebQQSession(session: Session) {
    // 多 OneBot 实例会共享同一套事件；模拟 bot 的 selfId 又会映射回源 bot。
    // 因此匹配规则必须由 OneBot WebQQ 服务统一判断，避免真实消息在切到模拟头像后被误过滤。
    return isVisibleBotSession(session, options.botScope) && options.webqq.isSelectedSelfId(session.bot.selfId)
  }

  function trimOldestMapEntries<TKey, TValue>(map: Map<TKey, TValue>, limit: number) {
    while (map.size > limit) {
      const oldestKey = map.keys().next().value
      if (oldestKey == null) break
      map.delete(oldestKey)
    }
  }

  function rememberLiveMessages(key: string, messages: WebQQMessage[]) {
    liveMessages.delete(key)
    liveMessages.set(key, messages)
    trimOldestMapEntries(liveMessages, WEBQQ_LIVE_CONVERSATION_LIMIT)
  }

  const affinityPeer = (peer: WebQQEventPeer) => {
    const selfId = options.webqq.getSelectedSelfId()
    return selfId ? { selfId, ...peer } : undefined
  }

  const getLiveSenderMetadataKey = (groupId: string, userId: string) => `${groupId}:${userId}`
  const getLiveSenderMetadata = (type: WebQQChatType, peerId: string, userId: string) => {
    return type === 'group' ? liveSenderMetadata.get(getLiveSenderMetadataKey(peerId, userId)) : undefined
  }
  const rememberLiveSenderMetadata = (type: WebQQChatType, peerId: string, userId: string, metadata: WebQQSenderMetadata) => {
    if (type !== 'group' || !hasWebQQSenderMetadata(metadata)) return false
    const key = getLiveSenderMetadataKey(peerId, userId)
    if (isSameWebQQSenderMetadata(liveSenderMetadata.get(key), metadata)) return false
    liveSenderMetadata.delete(key)
    liveSenderMetadata.set(key, metadata)
    trimOldestMapEntries(liveSenderMetadata, WEBQQ_LIVE_SENDER_METADATA_LIMIT)
    return true
  }
  const broadcastWebQQLivePayload = (payload: WebQQLiveMessage) => {
    const key = getWebQQLiveMessageKey(payload)
    const messages = mergeWebQQLiveMessages(liveMessages.get(key) ?? [], [payload.message], 100)
    rememberLiveMessages(key, messages)
    options.emitMessage(payload)
  }
  const broadcastWebQQRecallPayload = (payload: WebQQRecallPayload) => {
    const key = getWebQQLiveMessageKey(payload)
    const messages = applyWebQQRecallToLiveMessages(liveMessages.get(key) ?? [], payload, 100)
    rememberLiveMessages(key, messages)
    options.emitRecall(payload)
    return messages
  }
  const persistMarkedWebQQRecall = async (peer: WebQQEventPeer, message: WebQQMessage) => {
    try {
      const cachedMessages = await loadDatabaseWebQQRecalledMessageCache(options.storage, peer, options.getStorageScope())
      await saveDatabaseWebQQRecalledMessageCache(options.storage, options.config, {
        ...peer,
        messages: mergeWebQQLiveMessages(cachedMessages, [{ ...message, recalled: true }]),
      }, options.getStorageScope())
    } catch (error) {
      options.logger?.info('webqq recalled message cache failed %s', error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * 机器人消息进入观察窗时，接上 ChatLuna 回合的结果：回合进行中只记 ID，回合结束时补到最后一条回复上；
   * 回合已结束（v2 的回复经异步渲染队列发出，常晚于 idle）时，这条消息直接接手挂起的思考与用量。
   */
  const attachTurnResult = (payload: WebQQLiveMessage): WebQQLiveMessage => {
    if (payload.message.direction !== 'outgoing') return payload
    const key = getWebQQLiveMessageKey(payload)
    const replies = activeTurns.get(key)
    if (replies) {
      if (!replies.includes(payload.message.id)) replies.push(payload.message.id)
      return payload
    }
    const patch = pendingReplyPatches.get(key)
    if (!patch) return payload
    pendingReplyPatches.delete(key)
    return { ...payload, message: { ...payload.message, ...patch } }
  }

  const refreshWebQQLiveSenderMetadata = async (session: Session, payload: WebQQLiveMessage) => {
    if (payload.type !== 'group') return
    let metadata: WebQQSenderMetadata | undefined
    try {
      metadata = await readWebQQGroupSenderMetadata(session, payload.message.senderId, true)
    } catch (error) {
      options.logger?.info('webqq sender metadata refresh failed %s', error instanceof Error ? error.message : String(error))
      return
    }
    if (!metadata) return
    if (!rememberLiveSenderMetadata(payload.type, payload.peerId, payload.message.senderId, metadata)) return
    broadcastWebQQLivePayload({
      ...payload,
      message: replaceWebQQMessageSenderMetadata(payload.message, metadata),
    })
  }

  const recordWebQQLiveMessage = async (session: Session | undefined) => {
    if (!session) return
    if (!isSelectedWebQQSession(session)) return
    const direction = readWebQQLiveDirection(session)
    let payload = await createWebQQLiveMessage(
      session,
      direction,
      async (file, source) => {
        if (source === 'url') {
          const url = options.imageUrlResolver(file) || file
          options.logger?.info('webqq image url %s', JSON.stringify({ direction, url: file, proxyUrl: url }))
          return { url, debug: { url: file } }
        }
        const image = await options.webqq.resolveImage(file)
        options.logger?.info('webqq image %s', JSON.stringify({ direction, file, result: image.debug, url: image.url }))
        return image
      },
      async (id) => options.webqq.resolveQuote(id),
      async (id) => options.webqq.resolveForward(id),
      async (file, source) => {
        if (source === 'url') {
          const url = options.imageUrlResolver(file) || file
          options.logger?.info('webqq record url %s', JSON.stringify({ direction, url: file, proxyUrl: url }))
          return { url, debug: { url: file } }
        }
        const record = await options.webqq.resolveRecord(file)
        options.logger?.info('webqq record %s', JSON.stringify({ direction, file, result: record.debug, url: record.url }))
        return record
      },
    )
    if (!payload) return
    // SnowLuma 的历史以 message_id 为锚点，实时消息的序号与历史一样用 message_id，翻页游标才接得上。
    if (readConfigValue(options.config, 'onebotProtocol') === 'snowluma') {
      payload = { ...payload, message: { ...payload.message, sequence: payload.message.id } }
    }
    // 会话里出现新的用户消息：上一轮挂起的思考与用量不再属于之后的机器人消息。
    if (direction === 'incoming') pendingReplyPatches.delete(getWebQQLiveMessageKey(payload))
    payload = attachTurnResult({
      ...payload,
      message: fillWebQQMessageSenderMetadata(
        payload.message,
        getLiveSenderMetadata(payload.type, payload.peerId, payload.message.senderId),
      ),
    })
    const [messageWithAffinity = payload.message] = await options.attachAffinity([payload.message], affinityPeer(payload))
    payload = {
      ...payload,
      message: messageWithAffinity,
    }
    rememberLiveSenderMetadata(payload.type, payload.peerId, payload.message.senderId, readWebQQMessageSenderMetadata(payload.message))
    broadcastWebQQLivePayload(payload)
    await refreshWebQQLiveSenderMetadata(session, payload)
  }

  /**
   * 把机器人刚发出去的这条消息回显到观察窗：按发送 action 返回的 message_id 用 get_msg 读回来，渲染口径与
   * 历史完全一致。只有回报自发消息的实现才会把它作为 `message` 事件送回来（NapCat 的 report-self-message
   * 默认关闭），实现真的回报了时，两条按 message_id 合成一条。
   *
   * `fromTurn` 为假时是 WebQQ 里人工发出的消息，不接 ChatLuna 的思考与用量，否则会把下一条回复的思考块提前吃掉。
   */
  const recordSentWebQQMessage = async (peer: WebQQEventPeer, messageId: string | undefined, fromTurn = false) => {
    if (!messageId) return
    let message: WebQQMessage
    try {
      message = await options.webqq.resolveMessage(messageId)
    } catch (error) {
      options.logger?.info('webqq sent message echo failed %s', JSON.stringify({
        ...peer,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      }))
      return
    }
    const [messageWithAffinity = message] = await options.attachAffinity([message], affinityPeer(peer))
    const payload = { ...peer, message: messageWithAffinity }
    broadcastWebQQLivePayload(fromTurn ? attachTurnResult(payload) : payload)
  }

  /**
   * 机器人经 Satori 发出消息（ChatLuna 回复、其他插件）。一条 ChatLuna 回复会先后收到适配器回显与 ChatLuna
   * 归属两次 `send`，按 message_id 只处理一次；已经在实时缓存里的（实现回报了自发消息）不再读回。
   */
  const handledSends = new Set<string>()
  const recordBotSend = async (session: Session) => {
    if (!isSelectedWebQQSession(session) || !session.messageId) return
    const peer = readWebQQPeer(session)
    if (!peer) return
    const sendKey = `${session.selfId}:${session.messageId}`
    if (handledSends.has(sendKey)) return
    handledSends.add(sendKey)
    const oldest = handledSends.values().next().value
    if (handledSends.size > 500 && oldest) handledSends.delete(oldest)
    const known = liveMessages.get(getWebQQLiveMessageKey(peer))?.some((message) => message.id === session.messageId)
    if (known) return
    await recordSentWebQQMessage(peer, session.messageId, true)
  }

  const beginTurn = (target: WebQQTurnTarget) => {
    if (!options.webqq.isSelectedSelfId(target.selfId)) return
    const peer = readTurnPeer(target)
    if (!peer) return
    const key = getWebQQLiveMessageKey(peer)
    pendingReplyPatches.delete(key)
    activeTurns.set(key, [])
  }

  /**
   * 回合结束：有内心活动且开启显示时挂成思考块（用量随之显示在思考块里），否则把用量直接挂在回复上。
   * 本轮已经发出回复时补到最后一条上，还没有就挂起，交给之后发出的第一条机器人消息。
   */
  const finishTurn = (target: WebQQTurnTarget, result: WebQQTurnResult) => {
    const peer = readTurnPeer(target)
    if (!peer) return
    const key = getWebQQLiveMessageKey(peer)
    const replies = activeTurns.get(key)
    activeTurns.delete(key)
    if (!options.webqq.isSelectedSelfId(target.selfId)) return
    const showThinking = readConfigValue(options.config, 'showWebQQCharacterThinking') && !!result.thought
    const patch: WebQQReplyPatch = showThinking
      ? { thinking: { content: result.thought, durationMs: result.durationMs, ...(result.usage ? { usage: result.usage } : {}) } }
      : result.usage ? { usage: result.usage } : {}
    if (!patch.thinking && !patch.usage) return
    const lastReplyId = replies?.at(-1)
    const message = lastReplyId ? liveMessages.get(key)?.find((item) => item.id === lastReplyId) : undefined
    if (!message) {
      pendingReplyPatches.set(key, patch)
      trimOldestMapEntries(pendingReplyPatches, WEBQQ_LIVE_CONVERSATION_LIMIT)
      return
    }
    broadcastWebQQLivePayload({ ...peer, message: { ...message, ...patch } })
  }

  const recordWebQQRecall = async (session: Session | undefined) => {
    if (!session || (session.bot.platform || session.platform) !== 'onebot') return
    if (!isSelectedWebQQSession(session)) return
    const peer = readWebQQPeer(session)
    if (!peer) return
    const messageId = session.messageId || session.event.message?.id || readRawRecallMessageId(session)
    if (!messageId) return
    const operatorId = session.operatorId || session.event.operator?.id || session.userId || ''
    const operatorName = session.event.member?.name || session.event.operator?.name || session.event.user?.name || operatorId || '有人'
    const summary = `${operatorName} 撤回了一条消息`
    const markRecalledMessage = readConfigValue(options.config, 'webQQMarkRecalledMessages')
    const eventMessage: WebQQMessage = {
      id: `recall:${peer.type}:${peer.peerId}:${messageId}:${session.timestamp}`,
      sequence: `recall:${messageId}:${session.timestamp}`,
      time: session.timestamp,
      senderId: operatorId,
      senderName: operatorName,
      senderAvatar: resolveWebQQUserAvatar(readWebQQSessionUserAvatar(session), operatorId, readWebQQSessionAvatarScope(session)),
      direction: 'incoming',
      summary,
      event: {
        type: 'recall',
        targetMessageId: messageId,
      },
      elements: [{ type: 'unknown', text: summary }],
    }
    const messages = broadcastWebQQRecallPayload({
      ...peer,
      messageId,
      mode: markRecalledMessage ? 'mark' : 'remove',
      ...(markRecalledMessage ? {} : { eventMessage }),
    })
    if (!markRecalledMessage) return
    const recalledMessage = messages.find((message) =>
      (message.id === messageId || message.sequence === messageId) && message.recalled)
    // OneBot 历史接口通常不会再返回已撤回原消息；后端 live cache 也会在重启后丢失。
    // 因此在标记撤回模式下把原消息另存一份显示缓存，历史加载时再合并回来。
    if (recalledMessage) await persistMarkedWebQQRecall(peer, recalledMessage)
  }
  const noticeRuntime = createWebQQNoticeRuntime({ broadcastWebQQLivePayload })
  const reactionRuntime = createWebQQReactionRuntime({
    liveMessages,
    webqq: options.webqq,
    avatarScope: { synthesizeQQAvatars: !options.botScope.includeVirtualBots },
    logger: options.logger,
    broadcastWebQQLivePayload,
    rememberLiveMessages,
  })

  return {
    liveMessages,
    recordWebQQLiveMessage,
    recordSentWebQQMessage,
    recordBotSend,
    recordWebQQNotice: (session: Session | undefined) => {
      if (session && !isSelectedWebQQSession(session)) return
      return noticeRuntime.recordWebQQNotice(session)
    },
    recordWebQQReaction: reactionRuntime.recordWebQQReaction,
    recordWebQQRecall,
    beginTurn,
    finishTurn,
  }
}
