import { getNumberField, getStringField, isRecord } from '../../../onebot/data'

// NapCat / LLOneBot 的贴表情通过 OneBot11 通知 `group_msg_emoji_like` 上报，
// 但 adapter-onebot 没有对应的事件映射，会在 dispatch 前丢弃，
// 因此 `reaction-added` / `internal/session` 都收不到。这里直接挂到底层 WebSocket
// 上拦截原始事件。仅支持 ws / ws-reverse；http webhook 模式没有 socket，跳过。

export interface WebQQRawReaction {
  selfId?: string
  groupId: string
  userId: string
  messageId: string
  messageSeq?: string
  emojiId: string
  count: number
  isAdd: boolean
}

interface RawEventContext {
  bots: readonly unknown[]
  effect(execute: () => () => void): unknown
}

interface SocketLike {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener?(type: 'message', listener: (event: { data: unknown }) => void): void
}

const SOCKET_RESCAN_INTERVAL = 10000

function isSocketLike(value: unknown): value is SocketLike {
  return isRecord(value) && typeof value.addEventListener === 'function'
}

// 正向 ws 的 socket 在 satori WsClientBase 的 `bot.adapter.socket`；
// 反向 ws-reverse 的 socket 存在 adapter 模块的私有 Symbol `bot[kSocket]` 上。
function findBotSocket(bot: Record<string, unknown>): SocketLike | undefined {
  const adapter = bot.adapter
  if (isRecord(adapter) && isSocketLike(adapter.socket)) return adapter.socket
  for (const symbol of Object.getOwnPropertySymbols(bot)) {
    if (symbol.description !== 'socket') continue
    const socket = (bot as Record<symbol, unknown>)[symbol]
    if (isSocketLike(socket)) return socket
  }
  return undefined
}

function parseReaction(raw: unknown, selfId?: string): WebQQRawReaction | undefined {
  if (!isRecord(raw)) return
  if (raw.post_type !== 'notice') return
  if (getStringField(raw, ['notice_type']) !== 'group_msg_emoji_like') return
  const groupId = getStringField(raw, ['group_id'])
  const messageId = getStringField(raw, ['message_id'])
  if (!groupId || !messageId) return
  // LLBot 内部原始通知有 target.sequence，但翻译成 OneBot 事件后通常只剩 message_id；
  // 这里兼容少数实现透出的序号，后续可优先用它命中 WebQQ 消息。
  const target = isRecord(raw.target) ? raw.target : undefined
  const messageSeq = getStringField(raw, ['message_seq', 'messageSeq', 'msg_seq', 'msgSeq', 'seq']) ||
    (target ? getStringField(target, ['sequence']) : '')
  const likes = Array.isArray(raw.likes) ? raw.likes : []
  const like = likes.find(isRecord)
  const emojiId = like ? getStringField(like, ['emoji_id']) : ''
  if (!emojiId) return
  // NapCat 与 LLBot 用 is_add 表示增减；SnowLuma 不发 is_add，改用 sub_type 'add' | 'remove'。
  const isAdd = raw.is_add !== undefined ? raw.is_add !== false : raw.sub_type !== 'remove'
  return {
    ...(selfId ? { selfId } : {}),
    groupId,
    userId: getStringField(raw, ['user_id', 'operator_id']),
    messageId,
    ...(messageSeq ? { messageSeq } : {}),
    emojiId,
    count: like ? getNumberField(like, ['count']) : 0,
    isAdd,
  }
}

export function registerWebQQReactionInterceptor(ctx: RawEventContext, onReaction: (reaction: WebQQRawReaction) => void) {
  const bound = new WeakSet<SocketLike>()
  // Socket 属于 adapter-onebot，寿命长于本插件；不显式解绑的话，每次停用或修改插件都会在同一个
  // socket 上多留一个 message 监听器，之后每条 OneBot 帧都会被已 dispose 的运行时重复解析、
  // 重复广播，并重复发起 get_msg / fetch_emoji_like 动作。
  const boundSockets: Array<{ socket: SocketLike; listener: (event: { data: unknown }) => void }> = []
  let disposed = false

  const bindSocket = (socket: SocketLike, selfId?: string) => {
    if (bound.has(socket)) return
    bound.add(socket)
    const listener = (event: { data: unknown }) => {
      // dispose 之后仍可能收到已排队的帧；不支持 removeEventListener 的实现也要在这里止住。
      if (disposed) return
      let parsed: unknown
      try {
        parsed = JSON.parse(String((event as { data: unknown }).data))
      } catch {
        return
      }
      const reaction = parseReaction(parsed, selfId)
      if (reaction) onReaction(reaction)
    }
    socket.addEventListener('message', listener)
    boundSockets.push({ socket, listener })
  }

  const scan = () => {
    if (disposed) return
    for (const bot of ctx.bots) {
      if (!isRecord(bot) || bot.platform !== 'onebot') continue
      const socket = findBotSocket(bot)
      const selfId = getStringField(bot, ['selfId'])
      if (socket) bindSocket(socket, selfId)
    }
  }

  // 立即扫描一次，并周期性重扫以覆盖正向 ws 重连后 socket 实例被替换的情况。
  ctx.effect(() => {
    scan()
    const timer = setInterval(scan, SOCKET_RESCAN_INTERVAL)
    return () => {
      disposed = true
      clearInterval(timer)
      for (const { socket, listener } of boundSockets.splice(0)) {
        socket.removeEventListener?.('message', listener)
      }
    }
  })
}
