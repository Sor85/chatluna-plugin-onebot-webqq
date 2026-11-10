import type { OneBotRobotProfile } from '../../onebot/types'
import type {
  CapsuleActivityOptions,
  CapsuleBotInput,
  CapsuleMessageInput,
  CapsuleSnapshot,
} from './types'

export type {
  CapsuleActivityOptions,
  CapsuleBotInput,
  CapsuleMessageInput,
  CapsuleSnapshot,
} from './types'

const capsuleStateBrand: unique symbol = Symbol('onebot-webqq-state')

export interface CapsuleState {
  readonly [capsuleStateBrand]: true
  snapshot(): CapsuleSnapshot | undefined
}

interface MutableCapsuleState {
  current?: CapsuleSnapshot
  bots: OneBotRobotProfile[]
  counters: {
    received: number
    sent: number
  }
  thinkingStartedAt?: number
}

const states = new WeakMap<CapsuleState, MutableCapsuleState>()

function cloneSnapshot(snapshot: CapsuleSnapshot): CapsuleSnapshot {
  return {
    bot: { ...snapshot.bot },
    conversation: { ...snapshot.conversation },
    counters: { ...snapshot.counters },
    ...(snapshot.bots ? {
      bots: snapshot.bots.map((bot) => ({ ...bot })),
    } : {}),
  }
}

function getState(capsule: CapsuleState) {
  const state = states.get(capsule)
  if (!state) throw new TypeError('unknown capsule state')
  return state
}

function getBotName(input: CapsuleBotInput) {
  const name = input.name?.trim()
  if (name && name !== input.selfId) return name
  return '机器人'
}

// 创建聊天胶囊的内存状态容器。
export function createCapsuleState(): CapsuleState {
  const state: MutableCapsuleState = {
    bots: [],
    counters: {
      received: 0,
      sent: 0,
    },
  }

  const capsule = {
    [capsuleStateBrand]: true,
    snapshot() {
      return state.current && cloneSnapshot(state.current)
    },
  } satisfies CapsuleState
  states.set(capsule, state)
  return capsule
}

// 可用 Bot 列表已经按 action 通道收敛过适配器的滞后状态；命中同一个 selfId 时以列表为准。
// 未命中说明这个 Bot 不在 WebQQ 的可用集合里（例如被 selfId 白名单排除），此时只能保留原始上报值。
function readReconciledBot(bot: CapsuleSnapshot['bot'], bots: OneBotRobotProfile[]) {
  const profile = bots.find((candidate) => candidate.selfId === bot.selfId)
  if (!profile || profile.status === bot.status) return bot
  return { ...bot, status: profile.status }
}

function createSnapshot(input: CapsuleMessageInput, state: MutableCapsuleState): CapsuleSnapshot {
  return {
    bot: readReconciledBot({
      platform: input.bot.platform,
      selfId: input.bot.selfId,
      status: input.bot.status,
      name: getBotName(input.bot),
      avatar: input.bot.avatar,
    }, state.bots),
    conversation: {
      channelId: input.channel.id,
      channelName: input.channel.name || input.channel.id,
      timestamp: input.timestamp,
    },
    counters: {
      ...state.counters,
    },
    ...(state?.bots.length ? {
      bots: state.bots.map((bot) => ({ ...bot })),
    } : {}),
  }
}

export function setAvailableBots(capsule: CapsuleState, bots: OneBotRobotProfile[]) {
  const state = getState(capsule)
  state.bots = bots.map((bot) => ({ ...bot }))
  if (!state.current) return
  state.current = {
    ...state.current,
    // 快照里的 bot 状态来自消息发生时的 session.bot.status，是适配器原始上报值，可能停在 OFFLINE。
    // 可用 Bot 列表已经按 action 通道收敛过状态，快照必须跟随它，否则胶囊指示灯会与实际可用性矛盾。
    bot: readReconciledBot(state.current.bot, state.bots),
    ...(state.bots.length ? {
      bots: state.bots.map((bot) => ({ ...bot })),
    } : {
      bots: undefined,
    }),
  }
}

function copyActiveConversation(conversation: CapsuleSnapshot['conversation']) {
  return {
    userId: conversation.userId,
    userName: conversation.userName,
    senderRole: conversation.senderRole,
    senderLevel: conversation.senderLevel,
    senderTitle: conversation.senderTitle,
    activityText: conversation.activityText,
    ...(conversation.conversationId ? {
      conversationId: conversation.conversationId,
    } : {}),
    ...(conversation.thinkingDurationMs != null ? {
      thinkingDurationMs: conversation.thinkingDurationMs,
    } : {}),
  }
}

// 记录收到的消息上下文；空闲态不暴露最后发言用户。
export function recordIncomingMessage(capsule: CapsuleState, input: CapsuleMessageInput) {
  const state = getState(capsule)
  state.counters.received += 1
  const currentActivity = state.current?.conversation.activityText ? copyActiveConversation(state.current.conversation) : {}
  const snapshot = createSnapshot(input, state)
  state.current = {
    ...snapshot,
    conversation: {
      ...snapshot.conversation,
      ...currentActivity,
    },
  }
}

// 记录 ChatLuna 或伪装插件的当前对话状态。
export function recordConversationActivity(
  capsule: CapsuleState,
  input: CapsuleMessageInput,
  activityText: string,
  options: CapsuleActivityOptions = {},
) {
  const state = getState(capsule)
  state.thinkingStartedAt = activityText === '正在思考' ? options.now ?? Date.now() : undefined
  const snapshot = createSnapshot(input, state)
  state.current = {
    ...snapshot,
    conversation: {
      ...snapshot.conversation,
      userId: input.user.id,
      userName: input.user.name || input.user.id,
      senderRole: input.user.senderRole,
      senderLevel: input.user.senderLevel,
      senderTitle: input.user.senderTitle,
      activityText,
      ...(options.conversationId ? {
        conversationId: options.conversationId,
      } : {}),
    },
  }
}

function readThinkingDurationMs(state: MutableCapsuleState, now: number) {
  if (state.thinkingStartedAt == null) return state.current?.conversation.thinkingDurationMs
  return Math.max(0, now - state.thinkingStartedAt)
}

export function getCurrentThinkingDurationMs(capsule: CapsuleState, now = Date.now()) {
  return readThinkingDurationMs(getState(capsule), now) ?? 0
}

function copyIdleConversation(conversation: CapsuleSnapshot['conversation'], activityText?: string) {
  return {
    channelId: conversation.channelId,
    channelName: conversation.channelName,
    timestamp: conversation.timestamp,
    ...(activityText ? {
      activityText,
    } : {}),
    ...(conversation.thinkingDurationMs != null ? {
      thinkingDurationMs: conversation.thinkingDurationMs,
    } : {}),
  }
}

// 清除当前对话状态，保留最近的 bot、群聊和计数上下文。
export function clearConversationActivity(capsule: CapsuleState, now = Date.now()) {
  const state = getState(capsule)
  if (!state.current) return
  const conversation = state.current.conversation
  const thinkingDurationMs = readThinkingDurationMs(state, now)
  state.thinkingStartedAt = undefined
  state.current = {
    ...state.current,
    conversation: copyIdleConversation({
      ...conversation,
      ...(thinkingDurationMs != null ? {
        thinkingDurationMs,
      } : {}),
    }),
  }
}

// 日程插件只应该填充空闲文案，不能覆盖正在思考或正在对话的用户态。
export function recordIdleActivity(capsule: CapsuleState, activityText: string) {
  const state = getState(capsule)
  const text = activityText.trim()
  if (!state.current || !text) return false

  const conversation = state.current.conversation
  if (conversation.activityText === '正在思考' || conversation.userId || conversation.userName) return false
  if (conversation.activityText === text) return false

  state.thinkingStartedAt = undefined
  state.current = {
    ...state.current,
    conversation: copyIdleConversation(conversation, text),
  }
  return true
}

// 记录插件启动后的发送消息计数。
export function recordOutgoingMessage(capsule: CapsuleState) {
  const state = getState(capsule)
  state.counters.sent += 1
  if (!state.current) return
  state.current = {
    ...state.current,
    counters: {
      ...state.counters,
    },
  }
}
