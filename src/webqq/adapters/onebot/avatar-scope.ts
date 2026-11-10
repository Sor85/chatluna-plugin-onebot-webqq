import type { Session } from '@satorijs/core'
import { isVirtualOneBotBot } from '../../../onebot/bots'
import { readWebQQProvidedAvatar, type WebQQAvatarScope } from '../../display'

/**
 * 这台机器人的数据能不能由 id 合成腾讯 CDN 头像地址。
 *
 * 判据是「数据来自哪台机器人」而不是一个全局模式：虚拟机器人的 id 是提供方场景里的编号，
 * 真实机器人的 id 是 QQ 号。两者混在同一个运行时里时，这个判断也仍然逐条成立。
 *
 * ADR 0001：`webqq/message-flow/` 不直接 import `onebot/*`，OneBot 派生的判断由本层提供。
 */
export function readOneBotAvatarScope(bot: { platform?: unknown; hidden?: unknown }): WebQQAvatarScope {
  return { synthesizeQQAvatars: !isVirtualOneBotBot(bot) }
}

export function readWebQQSessionAvatarScope(session: Session): WebQQAvatarScope {
  return readOneBotAvatarScope(session.bot)
}

/** 事件里带的发送者头像。Satori 侧的 user / member 画像是提供方唯一会主动给出头像的地方。 */
export function readWebQQSessionUserAvatar(session: Session) {
  return readWebQQProvidedAvatar(session.event.member?.avatar)
    || readWebQQProvidedAvatar(session.event.user?.avatar)
    || readWebQQProvidedAvatar(session.author?.avatar)
}
