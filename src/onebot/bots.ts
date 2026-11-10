import { isRecord } from './data'
import { supportsOneBotAction, type OneBotBot } from './actions'

export interface OneBotContext {
  bots?: readonly unknown[]
}

/**
 * 候选机器人的取值范围。
 *
 * 默认只看真实机器人。`includeVirtualBots` 为真时反过来只看**虚拟 OneBot 机器人**：
 * 不是「把虚拟的加进来」而是「换成虚拟的」——WebQQ 的撤回、踢人、禁言都真发 action，
 * 两边混列就可能让人在开发者模拟环境里操作真实群。
 */
export interface OneBotBotScope {
  includeVirtualBots?: boolean
}

const oneBotOnlineStatus = 1

/**
 * 虚拟 OneBot 机器人：platform 为 `onebot`、对 UI 隐藏、action 通道由注册它的插件在自有场景中实现。
 *
 * 认的是这个通用形状而不是某个具体插件，因此任何提供这种机器人的插件都能当模拟环境的后端。
 * 真实机器人一侧不加 platform 判据：那会改变开关关闭时的候选集合。
 */
export function isVirtualOneBotBot(bot: { platform?: unknown; hidden?: unknown }) {
  return bot.hidden === true && bot.platform === 'onebot'
}

export function getOneBotBots(ctx: OneBotContext, scope: OneBotBotScope = {}) {
  return (ctx.bots ?? []).filter((bot): bot is OneBotBot => {
    if (!isRecord(bot) || !isRecord(bot.internal)) return false
    // Satori 的 hidden 用于保留运行时能力但阻止 UI 发现，虚拟 Bot 仍需留在 ctx.bots 中接收事件。
    if (scope.includeVirtualBots) return isVirtualOneBotBot(bot)
    return bot.hidden !== true
  })
}

function isOneBotReady(bot: OneBotBot) {
  return (typeof bot.status !== 'number' || bot.status === oneBotOnlineStatus) && supportsOneBotAction(bot)
}

// 某些适配器已能收到该 Bot 的消息时仍短暂上报 OFFLINE；实际活动（消息或主动探测）是比滞后状态更强的可用信号。
function isOneBotActionVerified(bot: OneBotBot, activeSelfIds?: ReadonlySet<string>) {
  return !!bot.selfId && !!activeSelfIds?.has(bot.selfId) && supportsOneBotAction(bot)
}

export function getOneBotProfileStatus(bot: OneBotBot, activeSelfIds?: ReadonlySet<string>) {
  if (typeof bot.status === 'number') {
    // 可用性判定已经用真实 action 通道证明这个 Bot 在线，对外画像必须跟随同一结论。
    // 否则适配器滞后上报 OFFLINE/CONNECT 期间，WebQQ 明明能正常收发消息，胶囊指示灯却显示为不在线。
    return isOneBotActionVerified(bot, activeSelfIds) ? oneBotOnlineStatus : bot.status
  }
  // 部分 OneBot 实现 action 可用但未提供 Satori 数字状态；仅通过现有可用性检查后才推导在线，避免把未知 Bot 误标为在线。
  return isOneBotReady(bot) ? oneBotOnlineStatus : undefined
}

// 最廉价的通用 OneBot action，仅用来证明 action 通道确实可用。
export const oneBotProbeAction = 'get_login_info'

function createOneBotAllowList(selfIds?: string[]) {
  return new Set((selfIds ?? []).map((selfId) => selfId.trim()).filter(Boolean))
}

function isAllowedOneBotBot(bot: OneBotBot, allowList: ReadonlySet<string>) {
  if (!allowList.size) return true
  return !!bot.selfId && allowList.has(bot.selfId)
}

// 虚拟机器人的 selfId 由提供方插件决定，不可能出现在管理员手写的白名单里。纳入虚拟机器人时
// 白名单不参与筛选，否则配了白名单的人永远看不到虚拟机器人。
function readScopedSelfIds(selfIds: string[] | undefined, scope: OneBotBotScope) {
  return scope.includeVirtualBots ? undefined : selfIds
}

export function getAvailableOneBotBots(
  ctx: OneBotContext,
  selfIds?: string[],
  activeSelfIds?: ReadonlySet<string>,
  scope: OneBotBotScope = {},
) {
  const scopedSelfIds = readScopedSelfIds(selfIds, scope)
  const allowList = createOneBotAllowList(scopedSelfIds)
  if (scopedSelfIds && !allowList.size) return []
  return getOneBotBots(ctx, scope).filter((bot) => {
    if (!isOneBotReady(bot) && !isOneBotActionVerified(bot, activeSelfIds)) return false
    return isAllowedOneBotBot(bot, allowList)
  })
}

// Koishi 重启后适配器可能长时间上报 OFFLINE/CONNECT，即使 action 通道早已可用。
// 这类 Bot 过去只能靠「等一条外部消息」触发 noteBotActivity 才会变可用，首屏因此加载失败。
// 这里挑出所有不自报就绪的 Bot 作为主动探测对象；已经如实上报在线的无需探测。
// 注意不能排除「当前靠活动覆盖才可用」的 Bot，否则覆盖会在 5 分钟后过期并造成可用性抖动。
export function getProbeableOneBotBots(ctx: OneBotContext, selfIds?: string[], scope: OneBotBotScope = {}) {
  const scopedSelfIds = readScopedSelfIds(selfIds, scope)
  const allowList = createOneBotAllowList(scopedSelfIds)
  if (scopedSelfIds && !allowList.size) return []
  return getOneBotBots(ctx, scope).filter((bot) => {
    if (!bot.selfId) return false
    if (isOneBotReady(bot)) return false
    if (!supportsOneBotAction(bot, oneBotProbeAction)) return false
    return isAllowedOneBotBot(bot, allowList)
  })
}

export function selectBot(ctx: OneBotContext, options: OneBotBotScope & { selfId?: string; selfIds?: string[]; activeSelfIds?: ReadonlySet<string> }) {
  const bots = getAvailableOneBotBots(ctx, options.selfIds, options.activeSelfIds, options)
  const selected = options.selfId
    ? bots.find((bot) => bot.selfId === options.selfId)
    : bots[0]
  if (!selected) {
    // 候选集合为空且要的是虚拟机器人时，缺的一定是提供方插件——即使调用方点名了某个 selfId，
    // 「未找到 selfId 为 X」也只会让人以为观察窗坏了。
    if (!bots.length && options.includeVirtualBots) throw new Error('未找到虚拟 OneBot 机器人，WebQQ 开发者模拟环境需要另装一个提供虚拟 OneBot 机器人的插件')
    if (options.selfId) throw new Error(`未找到 selfId 为 ${options.selfId} 的 OneBot 机器人`)
    throw new Error(options.selfIds ? '未找到配置 selfId 集合中的可用 OneBot 机器人' : '未找到可用的 OneBot 机器人')
  }
  return selected
}
