import type { Context } from 'cordis'
import type { Session } from '@satorijs/core'
import type {} from '@cordisjs/plugin-database'
import type {} from '@cordisjs/plugin-server'
import type {} from '@chatluna/server'
import { isVoiceIn, voiceForModel } from '@chatluna/transform'
import type { Config as PluginConfig } from './config/schema'
import { readConfigValue, readMirroredConfigValues } from './config/spec'
import { registerCapsule } from './capsule/register'
import { registerChatLunaTurns } from './chatluna/turns'
import { createMessageLanding } from './message-landing'
import type { OneBotBotScope } from './onebot/bots'
import { isVisibleBotSession } from './onebot/session'
import { getStringField, isRecord } from './onebot/data'
import { createWebuiBridge } from './webui'
import { createWebQQAffinityReader } from './webqq/affinity'
import { createOneBotWebQQService } from './webqq/adapters/onebot/service'
import { readWebQQBotGroupSenderMetadata } from './webqq/adapters/onebot/group-sender-metadata'
import { registerWebQQReactionInterceptor } from './webqq/adapters/onebot/reactions'
import { registerWebQQActions } from './webqq/console'
import { createWebQQImageUrlResolver, WEBQQ_IMAGE_ROUTE_PREFIX } from './webqq/media/image-url-resolver'
import { createWebQQLiveRuntime } from './webqq/message-flow/live-runtime'
import { createWebQQFriendRequestNotice, createWebQQGroupLeaveNotice } from './webqq/notices/event-notices'
import { chatCapsuleStorageTable, type WebQQStorageContext } from './webqq/storage/schema'
import type { WebQQNotice } from './webqq/types'

const AMR_HEADER = Buffer.from('#!AMR')

function getConfiguredOneBotSelfIds(config: PluginConfig) {
  return [...new Set(readConfigValue(config, 'onebotSelfIds').map((selfId) => selfId.trim()).filter(Boolean))]
}

/** 浏览器放不出来的语音转 WAV：SILK 在 WASM 里解码，AMR 需要系统里有 ffmpeg。其余格式原样返回。 */
async function transcodeVoice(body: Buffer) {
  if (!isVoiceIn('silk', body, 'application/octet-stream') && !body.subarray(0, AMR_HEADER.length).equals(AMR_HEADER)) return body
  return voiceForModel(body)
}

export function registerPluginRuntime(ctx: Context, config: PluginConfig) {
  const historyLimit = readConfigValue(config, 'historyLimit')
  const logger = readConfigValue(config, 'debug') ? ctx.logger : undefined
  const configuredOneBotSelfIds = getConfiguredOneBotSelfIds(config)
  const useRuntimeOneBotBots = readConfigValue(config, 'onebotUseRuntimeBots')
  // 开发者模拟环境把候选集合换成虚拟 OneBot 机器人，读写与实时链路都走真实 OneBot action 与真实 Satori 事件。
  const botScope: OneBotBotScope = {
    includeVirtualBots: readConfigValue(config, 'webQQMockEnvironment'),
  }
  // 虚拟机器人的 selfId 由提供方插件决定，白名单在模拟环境下整体不参与筛选，初始选中项同样不能钉在白名单第一项上。
  const initialOneBotSelfId = !useRuntimeOneBotBots && !botScope.includeVirtualBots
    ? configuredOneBotSelfIds[0]
    : undefined
  const storage: WebQQStorageContext = {
    get database() {
      return ctx.get('database')
    },
  }
  ctx.inject(['database'], (inner) => {
    inner.model.extend(chatCapsuleStorageTable, {
      id: 'string(128)',
      payload: 'json',
      updatedAt: 'timestamp',
    }, { primary: 'id' })
  })

  const imageUrlResolver = createWebQQImageUrlResolver({
    // 代理路由不在 /api 下，`<img src>` 才能直接加载；路径要从 WebUI 的 SPA 回退里排除，并自行校验登录 Cookie。
    serve(handle) {
      ctx.chatluna_webui.exclude(WEBQQ_IMAGE_ROUTE_PREFIX)
      ctx.server.get(`${WEBQQ_IMAGE_ROUTE_PREFIX}/:id`, async (req) => {
        if (!ctx.chatluna_server.verifyCookie(req)) return new Response(null, { status: 401 })
        return handle(req.params.id)
      })
    },
    transcodeVoice,
  }, logger, {
    cacheEnabled: readConfigValue(config, 'webQQImageCacheEnabled'),
    cacheLimitBytes: readConfigValue(config, 'webQQImageCacheLimitMB') * 1024 * 1024,
    cacheItemLimitBytes: readConfigValue(config, 'webQQImageCacheItemLimitMB') * 1024 * 1024,
  })
  const webqq = createOneBotWebQQService(ctx, {
    selfId: initialOneBotSelfId,
    selfIds: useRuntimeOneBotBots ? undefined : configuredOneBotSelfIds,
    mockBotCount: readConfigValue(config, 'onebotMockBotCount'),
    ...botScope,
    protocol: readConfigValue(config, 'onebotProtocol'),
    imageUrlResolver,
    logBotStatus: logger
      ? (source, data) => logger.info('[bot-status-debug] %s %s', source, JSON.stringify(data))
      : undefined,
  })

  const bridge = createWebuiBridge(ctx, () => {
    const botState = capsule.readBotState()
    return {
      ...botState,
      capsule: capsule.state.snapshot(),
      config: readMirroredConfigValues(config),
    }
  })
  const capsule = registerCapsule({
    ctx,
    bots: webqq,
    botScope,
    publish: () => bridge.refreshRuntime(),
    readBotSenderMetadata: readWebQQBotGroupSenderMetadata,
    logger,
  })
  const attachAffinity = createWebQQAffinityReader(ctx, () => readConfigValue(config, 'showWebQQAffinity'))
  const liveRuntime = createWebQQLiveRuntime({
    storage,
    config,
    webqq,
    botScope,
    imageUrlResolver,
    logger,
    attachAffinity,
    getStorageScope: capsule.getStorageScope,
    emitMessage: (payload) => bridge.emit({ type: 'message', payload }),
    emitRecall: (payload) => bridge.emit({ type: 'recall', payload }),
  })

  registerChatLunaTurns(ctx, {
    begin(target, startedAt) {
      liveRuntime.beginTurn(target)
      void capsule.beginThinking(target, startedAt)
    },
    finish(target, result) {
      liveRuntime.finishTurn(target, result)
      capsule.finishThinking()
    },
  })

  const friendRequestNotices = new Map<string, WebQQNotice>()
  const groupLeaveNotices = new Map<string, WebQQNotice>()
  registerWebQQActions(bridge, {
    ctx,
    storage,
    config,
    webqq,
    historyLimit,
    liveMessages: liveRuntime.liveMessages,
    friendRequestNotices,
    groupLeaveNotices,
    attachAffinity,
    getStorageScope: capsule.getStorageScope,
    recordSentMessage: liveRuntime.recordSentWebQQMessage,
    selectBot: (selfId) => {
      webqq.selectSelfId(selfId)
      const botState = capsule.readBotState()
      bridge.refreshRuntime()
      return botState
    },
    logger,
  })
  bridge.addEntry()

  ctx.on('message-deleted', (session) => liveRuntime.recordWebQQRecall(session))
  ctx.on('internal/session', (session) => liveRuntime.recordWebQQNotice(session))
  ctx.on('send', (session) => liveRuntime.recordBotSend(session))

  registerWebQQReactionInterceptor(ctx, (reaction) => {
    // 原始 WS listener 不会等待 Promise，这里必须兜住未预期异常，避免升级为全局 unhandled rejection。
    void liveRuntime.recordWebQQReaction(reaction).catch((error) => {
      logger?.info(
        'webqq raw reaction handling failed selfId=%s groupId=%s messageId=%s emojiId=%s error=%s',
        reaction.selfId || '',
        reaction.groupId,
        reaction.messageId,
        reaction.emojiId,
        error instanceof Error ? error.message : String(error),
      )
    })
  })

  // 通知菜单也是共享扇出边界：这两个事件写入的 notice 会经 loadNotices 进菜单，而菜单里的「同意」会拿事件里的
  // flag 去调当前选中机器人的 action。不按同一判据过滤，模拟环境下就会出现「用虚拟机器人批准真实好友申请」。
  ctx.on('friend-request', (session) => {
    if (!isVisibleBotSession(session, botScope)) return
    const notice = createWebQQFriendRequestNotice(session)
    if (notice) friendRequestNotices.set(notice.id, notice)
  })
  ctx.on('guild-member-removed', (session) => {
    if (!isVisibleBotSession(session, botScope)) return
    const notice = createWebQQGroupLeaveNotice(session)
    if (notice) groupLeaveNotices.set(notice.id, notice)
  })

  // 适配器重启后往往在一段时间内继续上报 OFFLINE/CONNECT，而 action 通道其实已经可用。这里主动探测
  // action 通道，让重启后无需外部消息即可正常显示。
  const probeBotAvailability = async (source: string) => {
    const changed = await webqq.probeBotAvailability().catch(() => false)
    if (!changed) return
    logger?.info('[bot-status-debug] %s %s', source, JSON.stringify({ service: webqq.getBotStatusDiagnostics() }))
    // 前端据运行状态里机器人列表的变化，自动重载失败过的联系人列表。
    bridge.refreshRuntime()
  }
  ctx.on('login-added', () => void probeBotAvailability('login-added-probe'))
  ctx.on('login-updated', () => void probeBotAvailability('login-updated-probe'))
  // 轮询兜底：覆盖「启动时 Bot 还没进 bots，之后也不再发生命周期事件」的情况，同时在只靠活动覆盖才可用的
  // 适配器上持续刷新覆盖。所有 Bot 都如实上报在线时没有探测对象，不会产生任何 OneBot 请求。
  ctx.effect(() => {
    const startup = setTimeout(() => void probeBotAvailability('startup-probe'), 0)
    const timer = setInterval(() => void probeBotAvailability('interval-probe'), 15 * 1000)
    return () => {
      clearTimeout(startup)
      clearInterval(timer)
    }
  })

  // 诊断数据要遍历全部 bot 并做 JSON 序列化；关闭 debug 时不能为每条消息都算一遍。
  const logMessageObserved = logger
    ? (session: Session) => {
      const matchingContextBots = ctx.bots.flatMap((candidate, index) => {
        if (!isRecord(candidate) || getStringField(candidate, ['selfId', 'self_id']) !== session.selfId) return []
        return [{
          index,
          sameReferenceAsSessionBot: candidate === session.bot,
          status: candidate.status,
          hidden: candidate.hidden === true,
        }]
      })
      logger.info('[bot-status-debug] message-observed %s', JSON.stringify({
        sessionBot: {
          platform: session.bot.platform,
          selfId: session.bot.selfId,
          status: session.bot.status,
          hidden: session.bot.hidden === true,
        },
        matchingContextBots,
        serviceBeforeActivity: webqq.getBotStatusDiagnostics(),
      }))
    }
    : undefined

  ctx.on('message', createMessageLanding({
    botScope,
    noteBotActivity: webqq.noteBotActivity,
    recordIncomingMessage: capsule.recordIncomingMessage,
    recordWebQQLiveMessage: liveRuntime.recordWebQQLiveMessage,
    ...(logMessageObserved ? { logMessageObserved } : {}),
  }))
}
