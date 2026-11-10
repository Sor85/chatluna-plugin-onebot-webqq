import type { Context } from 'cordis'
import type { Session } from '@satorijs/core'
import type { WebQQMessage } from '../webqq/types'
import { isRecord } from '../shared/record'
import { parseThinkContent } from '../webqq/thinking'

/** `reply` 工具（`render.reply = tool`）的名字，与 v2 `packages/chat/core/src/render/reply-tool.ts` 同步。 */
const REPLY_TOOL = 'reply'

export type WebQQTurnUsage = NonNullable<WebQQMessage['usage']>

/** 一轮回合结束时交给 WebQQ 的结果：角色内心活动、思考时长与本轮用量。 */
export interface WebQQTurnResult {
  thought: string
  durationMs: number
  usage?: WebQQTurnUsage
}

/** 回合所在的机器人会话：`session` 来自 `chat/receive`；唤醒回合只有 agent 的路由位置。 */
export interface WebQQTurnTarget {
  selfId: string
  channelId: string
  session?: Session
}

export interface WebQQTurnHandlers {
  begin(target: WebQQTurnTarget, startedAt: number): void
  finish(target: WebQQTurnTarget, result: WebQQTurnResult): void
}

interface ActiveTurn {
  target: WebQQTurnTarget
  startedAt: number
  thoughts: string[]
  usage?: WebQQTurnUsage
}

/** ChatLuna v2 agent 事件里本模块读取的字段；事件类型来自宿主，这里只做结构化读取，不引入编译期依赖。 */
interface AgentPayload {
  session?: { id?: unknown, messages?: () => unknown }
  options?: { location?: { selfId?: unknown, channel?: unknown } }
}

interface ChatLunaEventRegistrar {
  (event: 'chat/receive', listener: (session: Session, result: { sessionId?: unknown }) => void): () => void
  (event: 'chatluna/agent-status', listener: (payload: { agent?: AgentPayload, status?: unknown }) => void): () => void
  (event: 'chatluna/agent-step', listener: (payload: { agent?: AgentPayload, step?: unknown }) => void): () => void
}

function readString(value: unknown) {
  return typeof value === 'string' && value ? value : undefined
}

function readCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * 读一步模型调用里角色写下的内心活动（v2 character 引擎的 `<think>` 元素）。文本模式下元素留在 assistant
 * 文本块里；工具模式下写在 `reply` 工具的 `content` 参数里。模型原生的 reasoning 块不算内心活动。
 */
export function readStepThought(step: unknown) {
  const blocks: unknown[] = isRecord(step) && Array.isArray(step.content) ? step.content : []
  return blocks
    .map((block) => {
      if (!isRecord(block)) return ''
      if (block.type === 'text' && typeof block.text === 'string') return parseThinkContent(block.text)
      const content = isRecord(block.input) ? block.input.content : undefined
      if (block.type === 'tool-call' && block.toolName === REPLY_TOOL && typeof content === 'string') return parseThinkContent(content)
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * 这一步模型调用的计时。v2 把 `{ startedAt, firstTokenAt, endedAt }` 写在本步提交的 assistant 消息 meta 上，
 * agent-step 发出时提交已经完成，所以读会话里最后一条 assistant 消息即可。
 */
function readStepTiming(agent: AgentPayload | undefined) {
  const session = agent?.session
  if (typeof session?.messages !== 'function') return
  const list: unknown = session.messages()
  if (!Array.isArray(list)) return
  const last = [...list].reverse().find((message) => isRecord(message) && message.role === 'assistant')
  const timing = isRecord(last) && isRecord(last.meta) ? last.meta.timing : undefined
  if (!isRecord(timing)) return
  const startedAt = readCount(timing.startedAt)
  const firstTokenAt = readCount(timing.firstTokenAt)
  const endedAt = readCount(timing.endedAt)
  if (!startedAt || !endedAt) return
  return { startedAt, firstTokenAt, endedAt }
}

/**
 * 把 ChatLuna v2 的回合事件折算成 WebQQ 的思考状态、用量与内心活动。
 *
 * `chat/receive` 给出「agent 会话 ID → 机器人会话」映射，之后的 `agent-status`（busy / idle）与 `agent-step`
 * 只带会话 ID；`chat.wake` 唤醒的回合没有 `chat/receive`，映射改由 agent 自己的路由位置补上。v2 的 dispatch
 * 先唤醒 agent（同步发出 busy）再发 `chat/receive`，所以 busy 不论映射与否都先记下，映射晚到时 agent
 * 仍在 busy 就当场开始回合。
 */
export function registerChatLunaTurns(ctx: Context, handlers: WebQQTurnHandlers) {
  const turns = new Map<string, ActiveTurn>()
  const targets = new Map<string, WebQQTurnTarget>()
  const busy = new Set<string>()
  const on = ctx.on.bind(ctx) as unknown as ChatLunaEventRegistrar

  const begin = (sessionId: string, target: WebQQTurnTarget) => {
    const startedAt = Date.now()
    turns.set(sessionId, { target, startedAt, thoughts: [] })
    handlers.begin(target, startedAt)
  }

  const targetOf = (sessionId: string, agent: AgentPayload | undefined) => {
    const known = targets.get(sessionId)
    if (known) return known
    const location = agent?.options?.location
    const selfId = readString(location?.selfId)
    const channelId = readString(location?.channel)
    if (!selfId || !channelId) return
    const target = { selfId, channelId }
    targets.set(sessionId, target)
    return target
  }

  on('chat/receive', (session, result) => {
    const sessionId = readString(result?.sessionId)
    if (!sessionId || !session.selfId || !session.channelId) return
    const target = { selfId: session.selfId, channelId: session.channelId, session }
    targets.set(sessionId, target)
    if (busy.has(sessionId) && !turns.has(sessionId)) begin(sessionId, target)
  })

  on('chatluna/agent-status', ({ agent, status }) => {
    const sessionId = readString(agent?.session?.id)
    if (!sessionId) return
    if (status !== 'busy') {
      busy.delete(sessionId)
      const turn = turns.get(sessionId)
      if (!turn) return
      turns.delete(sessionId)
      handlers.finish(turn.target, {
        thought: turn.thoughts.join('\n\n'),
        durationMs: Math.max(0, Date.now() - turn.startedAt),
        ...(turn.usage ? { usage: turn.usage } : {}),
      })
      return
    }
    busy.add(sessionId)
    const target = targetOf(sessionId, agent)
    // 上一轮没收到 idle（上游报错中断）时直接重开：用量、思考与计时都从这一轮算起。
    if (target) begin(sessionId, target)
  })

  on('chatluna/agent-step', ({ agent, step }) => {
    const sessionId = readString(agent?.session?.id)
    const turn = sessionId ? turns.get(sessionId) : undefined
    if (!turn) return
    const thought = readStepThought(step)
    if (thought) turn.thoughts.push(thought)
    const usage = isRecord(step) && isRecord(step.usage) ? step.usage : undefined
    if (!usage) return
    // v2 的 inputTokens 只是未命中缓存的部分，按 billedInputTokens 口径把缓存读写加回来。每一步都把整段
    // 上下文重发一遍，输入取最后一步；输出是各步新生成的，累加。计时取最后一步：它产出了这条回复。
    const inputTokens = readCount(usage.inputTokens) + readCount(usage.cacheReadTokens) + readCount(usage.cacheWriteTokens)
    const stepOutputTokens = readCount(usage.outputTokens)
    const timing = readStepTiming(agent)
    const generationMs = timing?.firstTokenAt ? timing.endedAt - timing.firstTokenAt : 0
    turn.usage = {
      inputTokens,
      outputTokens: (turn.usage?.outputTokens ?? 0) + stepOutputTokens,
      ...(timing?.firstTokenAt ? { ttftMs: timing.firstTokenAt - timing.startedAt } : {}),
      ...(timing ? { totalMs: timing.endedAt - timing.startedAt } : {}),
      ...(generationMs > 0 && stepOutputTokens ? { tps: stepOutputTokens / (generationMs / 1000) } : {}),
    }
  })
}
