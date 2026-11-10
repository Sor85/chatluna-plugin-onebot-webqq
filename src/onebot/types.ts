import type { WebQQProtocol } from './protocol'

export type { WebQQProtocol } from './protocol'

type OneBotImageUrlResolver = (file: string, options?: { refresh?: () => Promise<string> }) => string

export interface OneBotRobotProfile {
  platform: string
  selfId: string
  status?: number
  name: string
  avatar?: string
}

export interface OneBotRobotState {
  bots: OneBotRobotProfile[]
  selectedSelfId?: string
}

export interface OneBotWebQQOptions {
  selfId?: string
  selfIds?: string[]
  mockBotCount?: number
  /** 纳入虚拟 OneBot 机器人：开发者模拟环境把候选集合换成它们，真实机器人不参与。 */
  includeVirtualBots?: boolean
  protocol?: WebQQProtocol
  imageUrlResolver?: OneBotImageUrlResolver
  logBotStatus?: (source: string, data: Record<string, unknown>) => void
}
