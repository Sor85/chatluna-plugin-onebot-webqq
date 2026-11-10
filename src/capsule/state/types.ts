import type { OneBotRobotProfile } from '../../onebot/types'

// 消息落地时拿到的机器人上下文：这条路径上机器人确实可能没有名字，所以 name 是可选的。
// 快照里的可用机器人列表不是这个类型，见 CapsuleSnapshot.bots。
export interface CapsuleBotInput {
  platform: string
  selfId: string
  status?: number
  name?: string
  avatar?: string
}

export interface CapsuleMessageInput {
  bot: CapsuleBotInput
  channel: {
    id: string
    name?: string
  }
  user: {
    id: string
    name?: string
    senderRole?: string
    senderLevel?: string
    senderTitle?: string
  }
  timestamp: number
}

export interface CapsuleActivityOptions {
  conversationId?: string
  now?: number
}

export interface CapsuleSnapshot {
  bot: {
    platform: string
    selfId: string
    status?: number
    name: string
    avatar?: string
  }
  conversation: {
    channelId: string
    channelName: string
    userId?: string
    userName?: string
    senderRole?: string
    senderLevel?: string
    senderTitle?: string
    activityText?: string
    conversationId?: string
    thinkingDurationMs?: number
    timestamp: number
  }
  counters: {
    received: number
    sent: number
  }
  // 唯一的生产者是可用机器人列表，那份列表里的机器人一定带名字，所以这里用机器人画像类型而不是
  // CapsuleBotInput。用后者会让这个字段对现实撒谎，消费点得为一个实际不会出现的情况加兜底。
  bots?: OneBotRobotProfile[]
}
