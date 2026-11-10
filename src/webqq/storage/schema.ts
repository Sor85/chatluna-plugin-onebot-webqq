import type { Database } from '@cordisjs/plugin-database'
import type { WebQQMessage } from '../types'

export interface WebQQStoragePayload {
  conversationSummaries?: Record<string, { summary: string; time: number }>
  conversationUnreadCounts?: Record<string, number>
  hiddenRecentKeys?: string[]
  messages?: WebQQMessage[]
}

export interface ChatCapsuleStorageRow {
  id: string
  payload: WebQQStoragePayload
  updatedAt: Date
}

/** 数据库是可选服务，按需现取：未加载时浏览器存储照常可用，数据库存储报错。 */
export interface WebQQStorageContext {
  readonly database?: Database
}

export const chatCapsuleStorageTable = 'onebot_webqq_storage' as const

export function getWebQQDatabase(ctx: WebQQStorageContext) {
  if (!ctx.database) throw new Error('ChatLuna 数据库服务不可用')
  return ctx.database
}
