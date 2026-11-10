import type { Config } from '../../config/schema'
import { readConfigValue } from '../../config/spec'
import { isRecord } from '../../shared/record'
import { chatCapsuleStorageTable, type WebQQStorageContext } from './schema'
import {
  readWebQQStoredMessages,
  type WebQQMessageCachePayload,
  type WebQQMessageCacheQuery,
} from './message-cache'
import { getWebQQRecalledMessageStorageId } from './scope'

export async function loadDatabaseWebQQRecalledMessageCache(ctx: WebQQStorageContext, query: WebQQMessageCacheQuery, scopeId?: string) {
  if (!ctx.database) return []
  const [row] = await ctx.database.get(chatCapsuleStorageTable, { id: getWebQQRecalledMessageStorageId(query, scopeId) })
  return readWebQQStoredMessages(isRecord(row) ? row.payload : undefined)
}

export async function saveDatabaseWebQQRecalledMessageCache(ctx: WebQQStorageContext, config: Config, payload: WebQQMessageCachePayload, scopeId?: string) {
  if (!ctx.database) return
  const messageCacheLimit = readConfigValue(config, 'webQQMessageCacheLimit')
  const messages = payload.messages.filter((message) => message.recalled).slice(-messageCacheLimit)
  if (!messages.length) return
  await ctx.database.upsert(chatCapsuleStorageTable, [{
    id: getWebQQRecalledMessageStorageId(payload, scopeId),
    payload: { messages },
    updatedAt: new Date(),
  }])
}
