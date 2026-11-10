import type { Context } from 'cordis'
import type { Config as PluginConfig } from '../config/schema'
import { readConfigValue } from '../config/spec'
import type { WebuiBridge } from '../webui'
import type { WebQQChatType, WebQQMessage, WebQQNotice } from './types'
import type { WebQQService } from './adapters/types'
import type { DebugLogger } from '../shared/logger'
import type { WebQQAffinityReader } from './affinity'
import { searchWebQQMessageHistory } from './message-search'
import { getWebQQLiveMessageKey, mergeWebQQLiveMessages } from './message-flow/live-cache'
import { loadDatabaseWebQQMessageCache, saveDatabaseWebQQMessageCache } from './storage/message-cache'
import { loadDatabaseWebQQRecalledMessageCache } from './storage/recall-cache'
import { loadWebQQStorage, saveWebQQStorage } from './storage/state'
import type { WebQQStorageContext } from './storage/schema'

export function registerWebQQActions(
  bridge: WebuiBridge,
  options: {
    ctx: Context
    storage: WebQQStorageContext
    config: PluginConfig
    webqq: WebQQService
    historyLimit: number
    liveMessages: Map<string, WebQQMessage[]>
    friendRequestNotices: Map<string, WebQQNotice>
    groupLeaveNotices: Map<string, WebQQNotice>
    attachAffinity: WebQQAffinityReader
    getStorageScope: () => string | undefined
    recordSentMessage: (peer: { type: WebQQChatType; peerId: string }, messageId: string | undefined) => Promise<void>
    selectBot: (selfId: string) => ReturnType<WebQQService['reconcileBotState']>
    logger?: DebugLogger
  },
) {
  const {
    storage,
    config,
    webqq,
    historyLimit,
    liveMessages,
    friendRequestNotices,
    groupLeaveNotices,
    attachAffinity,
    getStorageScope,
    recordSentMessage,
    logger,
  } = options

  bridge.action('onebot-webqq.contacts', async () => {
    try {
      return await webqq.loadContacts()
    } catch (error) {
      const botState = webqq.reconcileBotState()
      logger?.info('contacts-load-failed %s', JSON.stringify({
        selectedSelfId: botState.selectedSelfId,
        bots: botState.bots.map((bot) => ({ selfId: bot.selfId, status: bot.status })),
        service: webqq.getBotStatusDiagnostics(),
        error: error instanceof Error ? error.message : String(error),
      }))
      throw error
    }
  })
  bridge.action('onebot-webqq.messages', async (query) => {
    const nextQuery = {
      ...query,
      limit: query.limit ?? historyLimit,
    }
    const history = await webqq.loadMessages(nextQuery)
    const messages = mergeWebQQLiveMessages(history, liveMessages.get(getWebQQLiveMessageKey(nextQuery)), nextQuery.limit)
    const recalledMessages = readConfigValue(config, 'webQQMarkRecalledMessages')
      ? await loadDatabaseWebQQRecalledMessageCache(storage, nextQuery, getStorageScope())
      : []
    const mergedMessages = mergeWebQQLiveMessages(messages, recalledMessages)
    const selfId = webqq.getSelectedSelfId()
    return attachAffinity(mergedMessages, selfId ? { selfId, type: query.type, peerId: query.peerId } : undefined)
  })
  bridge.action('onebot-webqq.messages.search', async (query) => {
    // SnowLuma 翻一页群历史要多次请求、彼此间隔 300ms，页要小、单页超时要长，短页也不算到头。
    const snowluma = readConfigValue(config, 'onebotProtocol') === 'snowluma'
    return searchWebQQMessageHistory(query, {
      pageSize: snowluma ? Math.min(historyLimit, 40) : Math.min(historyLimit, 100),
      maxPages: 10,
      ...(snowluma ? { pageTimeoutMs: 8000, searchTimeoutMs: 16000, shortPageMayContinue: true } : {}),
      loadMessages: (messageQuery) => webqq.loadMessages(messageQuery),
      loadCachedMessages: query.beforeSequence
        ? undefined
        : async () => {
          const live = liveMessages.get(getWebQQLiveMessageKey(query)) ?? []
          try {
            const cached = await loadDatabaseWebQQMessageCache(storage, config, {
              type: query.type,
              peerId: query.peerId,
            }, getStorageScope())
            return mergeWebQQLiveMessages(cached, live)
          } catch {
            return live
          }
        },
    })
  })
  bridge.action('onebot-webqq.group-info', (query) => webqq.loadGroupInfo(query))
  bridge.action('onebot-webqq.record.transcribe', (query) => webqq.transcribeRecord(query.messageId))
  bridge.action('onebot-webqq.notices', () => webqq.loadNotices([...friendRequestNotices.values(), ...groupLeaveNotices.values()]))
  bridge.action('onebot-webqq.notice-action', async (action) => {
    await webqq.handleNotice(action)
    if (action.type !== 'friend-request') return
    const notice = friendRequestNotices.get(action.id)
    if (!notice) return
    friendRequestNotices.set(action.id, {
      ...notice,
      status: action.approve ? 'approved' : 'rejected',
    })
  })
  bridge.action('onebot-webqq.send', async (payload) => {
    const messageId = await webqq.sendMessage(payload)
    // 发完立刻回显，不依赖实现是否回报自发消息；回显失败不影响这次发送成功。
    await recordSentMessage({ type: payload.type, peerId: payload.peerId }, messageId)
  })
  bridge.action('onebot-webqq.message-recall', (input) => webqq.recallMessage(input))
  bridge.action('onebot-webqq.message-reaction', (input) => webqq.setMessageReaction(input))
  bridge.action('onebot-webqq.profile', (query) => webqq.loadProfile(query))
  bridge.action('onebot-webqq.self-profile', (input) => webqq.updateSelfProfile(input))
  bridge.action('onebot-webqq.friend-action', (input) => webqq.performFriendAction(input))
  bridge.action('onebot-webqq.group-action', (input) => webqq.performGroupAction(input))
  bridge.action('onebot-webqq.forward-send', async (input) => {
    const messageId = await webqq.sendForward(input)
    await recordSentMessage({ type: input.type, peerId: input.peerId }, messageId)
  })
  bridge.action('onebot-webqq.bot.select', async (input) => options.selectBot(input.selfId))
  bridge.action('onebot-webqq.storage.load', () => loadWebQQStorage(storage, config, getStorageScope()))
  bridge.action('onebot-webqq.storage.save', (state) => saveWebQQStorage(storage, config, state, getStorageScope()))
  bridge.action('onebot-webqq.messages.cache.load', (query) => loadDatabaseWebQQMessageCache(storage, config, query, getStorageScope()))
  bridge.action('onebot-webqq.messages.cache.save', (payload) => saveDatabaseWebQQMessageCache(storage, config, payload, getStorageScope()))
}
