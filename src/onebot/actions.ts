import { getStringField, isRecord } from './data'

export interface OneBotBot {
  platform?: string
  selfId?: string
  name?: string
  username?: string
  user?: {
    id?: string
    name?: string
    nick?: string
    username?: string
    nickname?: string
    avatar?: string
  }
  avatar?: string
  status?: number
  hidden?: boolean
  internal: OneBotInternal
}

export interface OneBotInternal extends Record<string, unknown> {
  _request?: (action: string, params: Record<string, unknown>) => Promise<unknown>
}

export function supportsOneBotAction(bot: OneBotBot, action?: string) {
  if (action) return typeof bot.internal._request === 'function' || typeof bot.internal[action] === 'function'
  return typeof bot.internal._request === 'function' ||
    typeof bot.internal.get_friend_list === 'function' ||
    typeof bot.internal.get_group_list === 'function' ||
    typeof bot.internal.get_group_member_list === 'function' ||
    typeof bot.internal.get_group_system_msg === 'function' ||
    typeof bot.internal.set_friend_add_request === 'function' ||
    typeof bot.internal.set_group_add_request === 'function'
}

// adapter-onebot 的 `_request` 对业务失败（retcode 非 0）也照常 resolve 整个响应信封。不在这里转成异常，
// 失败的操作会被当成成功，按别名依次尝试的 callSupportedAction 也永远停在第一个名字上。
function assertOneBotResponse(action: string, result: unknown) {
  if (!isRecord(result) || typeof result.retcode !== 'number') return result
  if (result.retcode === 0 && result.status !== 'failed') return result
  const reason = getStringField(result, ['wording', 'message', 'msg']) || String(result.status ?? 'failed')
  throw new Error(`${action} 失败：${reason}（retcode ${result.retcode}）`)
}

export async function callAction(bot: OneBotBot, action: string, params?: Record<string, unknown>) {
  if (typeof bot.internal._request === 'function') {
    return assertOneBotResponse(action, await bot.internal._request(action, params ?? {}))
  }
  const method = bot.internal[action]
  if (typeof method !== 'function') throw new Error(`当前 OneBot 实现不支持 ${action}`)
  return method.call(bot.internal, params)
}

/**
 * 按顺序尝试同一件事在各 OneBot 实现下的不同 action 名，返回第一个成功的结果。
 *
 * NapCat 与 LLBot 对同一能力常用不同 action 名（语音转文字就是 `fetch_ptt_text` 与
 * `voice_msg_to_text`）。调用方按当前协议把更可能命中的名字排在前面，配置与实际实现不符时
 * 仍能靠后续别名兜住。
 */
export async function callSupportedAction(
  bot: OneBotBot,
  actions: string[],
  params: Record<string, unknown>,
) {
  let lastError: unknown
  for (const action of actions) {
    // 有 _request 时 supportsOneBotAction 对任意 action 都为 true，这里仍按顺序尝试，
    // 直到真实实现接受其中一个别名，避免 NapCat/LLBot 命名差异导致直接失败。
    if (!supportsOneBotAction(bot, action) && typeof bot.internal._request !== 'function') {
      continue
    }
    try {
      return await callAction(bot, action, params)
    } catch (error) {
      lastError = error
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error(`当前 OneBot 实现不支持 ${actions.join(' / ')}`)
}
