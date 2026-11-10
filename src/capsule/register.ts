import type { Context } from 'cordis'
import type { Session } from '@satorijs/core'
import type { OneBotRobotState } from '../onebot/types'
import type { OneBotBotScope } from '../onebot/bots'
import { isVisibleBot, isVisibleBotSession } from '../onebot/session'
import type { WebQQTurnTarget } from '../chatluna/turns'
import { createMessageInput, readCapsuleMemberName } from './message-input'
import {
  clearConversationActivity,
  createCapsuleState,
  getCurrentThinkingDurationMs,
  recordConversationActivity,
  recordIncomingMessage,
  recordOutgoingMessage,
  setAvailableBots,
  type CapsuleMessageInput,
} from './state'

export interface CapsuleBotRuntime {
  reconcileBotState(): OneBotRobotState
  getBotStatusDiagnostics(): Record<string, unknown>
}

type CapsuleSenderMetadata = Pick<CapsuleMessageInput['user'], 'senderRole' | 'senderLevel' | 'senderTitle'>

export const THINKING_ACTIVITY = '正在思考'

export function registerCapsule(options: {
  ctx: Context
  bots: CapsuleBotRuntime
  botScope: OneBotBotScope
  /** 小胶囊或机器人列表变了：刷新下发给前端的运行状态。 */
  publish: () => void
  readBotSenderMetadata: (session: Session) => Promise<CapsuleSenderMetadata | undefined>
  logger?: Context['logger']
}) {
  const { ctx, bots: botRuntime, botScope, publish, readBotSenderMetadata, logger } = options
  const state = createCapsuleState()
  const logSnapshot = (source: string) => logger?.info(`${source} %s`, JSON.stringify(state.snapshot() ?? null))
  const readBotState = (): OneBotRobotState => {
    // fallback 和闭包选择必须由 service 一次性收敛，避免对外状态已清空但 action 仍使用旧 selfId。
    const botState = botRuntime.reconcileBotState()
    setAvailableBots(state, botState.bots)
    return botState
  }
  const handleBotLifecycle = (source: string) => {
    const botState = readBotState()
    logger?.info('[bot-status-debug] %s %s', source, JSON.stringify({
      result: {
        selectedSelfId: botState.selectedSelfId,
        bots: botState.bots.map((bot) => ({ selfId: bot.selfId, status: bot.status })),
      },
      service: botRuntime.getBotStatusDiagnostics(),
    }))
    publish()
  }
  // Bot 在页面加载后上线时不会产生消息事件，必须由生命周期事件同步列表和 selectedSelfId，否则胶囊会永久使用初始离线状态。
  ctx.on('login-added', () => handleBotLifecycle('login-added'))
  ctx.on('login-removed', () => handleBotLifecycle('login-removed'))
  ctx.on('login-updated', () => handleBotLifecycle('login-updated'))

  // 机器人发出的每条消息计一次。adapter-onebot 发送后派发的 `send` 会话不带正文，计数够用。
  ctx.on('send', (session) => {
    if (!isVisibleBotSession(session, botScope)) return
    recordOutgoingMessage(state)
    logSnapshot('send')
    publish()
  })

  /**
   * ChatLuna 回合开始：胶囊显示「正在思考」。来自 `chat/receive` 的回合有触发它的消息，可以显示对方；
   * 唤醒回合只有路由位置，按频道显示。群聊里再补一次机器人自己的群身份，供等待气泡显示头衔。
   */
  const beginThinking = async (target: WebQQTurnTarget, startedAt: number) => {
    const session = target.session
    if (session && !isVisibleBotSession(session, botScope)) return
    const input = session ? createMessageInput(session) : createLocationInput(target)
    if (!input) return
    if (session) input.user.name = readCapsuleMemberName(session) || input.user.name
    recordConversationActivity(state, input, THINKING_ACTIVITY, { now: startedAt })
    logSnapshot('generating')
    publish()
    const botSenderMetadata = session ? await readBotSenderMetadata(session).catch(() => undefined) : undefined
    if (!botSenderMetadata) return
    recordConversationActivity(state, {
      ...input,
      user: { ...input.user, ...botSenderMetadata },
    }, THINKING_ACTIVITY, { now: startedAt })
    logSnapshot('generating-metadata')
    publish()
  }

  const createLocationInput = (target: WebQQTurnTarget): CapsuleMessageInput | undefined => {
    const bot = ctx.bots.find((candidate) => candidate.platform === 'onebot' && candidate.selfId === target.selfId)
    if (!bot || !isVisibleBot(bot, botScope)) return
    const user = bot.toJSON().user
    const userId = target.channelId.startsWith('private:') ? target.channelId.slice('private:'.length) : ''
    return {
      bot: {
        platform: 'onebot',
        selfId: target.selfId,
        status: bot.status,
        name: user?.name,
        avatar: user?.avatar,
      },
      channel: { id: target.channelId },
      user: { id: userId || target.channelId },
      timestamp: Date.now(),
    }
  }

  const finishThinking = () => {
    clearConversationActivity(state)
    logSnapshot('after-chat')
    publish()
  }

  return {
    state,
    readBotState,
    beginThinking,
    finishThinking,
    getThinkingDurationMs: () => getCurrentThinkingDurationMs(state),
    getStorageScope: () => {
      const botState = readBotState()
      return botState.bots.length > 1 ? botState.selectedSelfId : undefined
    },
    recordIncomingMessage: (session: Session) => {
      recordIncomingMessage(state, createMessageInput(session))
      logSnapshot('message')
      publish()
    },
  }
}
