import type { Session } from '@satorijs/core'
import { isVirtualOneBotBot, type OneBotBotScope } from './bots'

/**
 * 事件所属的 Bot 是否在当前候选集合里。
 *
 * 默认排除对 UI 隐藏的 Bot。纳入虚拟机器人时反过来只放行虚拟 OneBot 机器人：候选集合与事件扇出
 * 必须同一个判据，否则开发者模拟环境会一边只列虚拟机器人、一边继续把真实群的消息推进观察窗。
 */
export function isVisibleBotSession(session?: Session, scope: OneBotBotScope = {}) {
  return !session || isVisibleBot(session.bot, scope)
}

export function isVisibleBot(bot: { platform?: unknown, hidden?: unknown }, scope: OneBotBotScope = {}) {
  if (scope.includeVirtualBots) return isVirtualOneBotBot(bot)
  return bot.hidden !== true
}
