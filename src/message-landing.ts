import type { Session } from '@satorijs/core'
import type { OneBotBotScope } from './onebot/bots'
import { isVisibleBotSession } from './onebot/session'

/**
 * **消息落地**：一条消息进入插件后被各领域依次记录的过程。
 *
 * 住在这里而不是 `webqq/message-flow/` 里：这四步是**跨领域**编排，让 WebQQ 去指挥主胶囊会撞上
 * ADR 0001 的依赖方向。也不住在 `runtime/`：那是装配层，按 ADR 0001 只创建和传递共享依赖、不写
 * 业务流程，这条流程正是从它里面抽出来的。
 *
 * 四个下游全部注入，因此次序可以由注入的假实现按调用与完成两类事件证明。ADR 0009：这里不返回
 * 步骤清单，也不以任何形式对外暴露「我依次做了什么」——那样的返回值唯一的消费者会是测试。
 */
export type MessageLanding = (session: Session) => Promise<void>

export function createMessageLanding(options: {
  botScope: OneBotBotScope
  noteBotActivity: (selfId: string) => void
  recordIncomingMessage: (session: Session) => void
  recordWebQQLiveMessage: (session: Session) => Promise<void>
  /** 诊断日志的**位置**由本 module 拥有（门禁之后、四步之前），内容由调用方构造。 */
  logMessageObserved?: (session: Session) => void
}): MessageLanding {
  return async (session) => {
    // hidden Bot 仍会发出标准 Satori 事件；在共享扇出边界阻断，避免胶囊状态和 WebQQ 未读一起被污染。
    // 纳入虚拟机器人时判据反过来：只有虚拟机器人的事件能进，真实群的消息不进模拟环境。
    if (!isVisibleBotSession(session, options.botScope)) return
    options.logMessageObserved?.(session)
    // 收到真实消息已证明 action 通道至少刚刚可用；先记录活动，再广播 Bot 状态，
    // 避免适配器仍上报 OFFLINE 时 WebQQ 永久排除该 Bot。
    options.noteBotActivity(session.selfId)
    options.recordIncomingMessage(session)
    await options.recordWebQQLiveMessage(session)
  }
}
