import type { Config } from '../../config/schema'
import { readConfigValue } from '../../config/spec'
import { isRecord } from '../../shared/record'
import type { WebQQConversationSummary, WebQQStoredState } from '../types'
import { chatCapsuleStorageTable, getWebQQDatabase, type WebQQStorageContext } from './schema'
import { getWebQQStateStorageId } from './scope'

// 载荷类型住在零 koishi 依赖的 ../types 里（本 module 引用了配置入口与数据库机件，控制台契约
// 不能经由它取类型）。这里 re-export，服务端既有消费方的 import 路径一处不动。
export type { WebQQConversationSummary, WebQQStoredState } from '../types'

function createEmptyWebQQStoredState(): WebQQStoredState {
  return {
    conversationSummaries: {},
    conversationUnreadCounts: {},
    hiddenRecentKeys: [],
  }
}

function readWebQQStoredConversationSummaries(value: unknown) {
  const summaries: Record<string, WebQQConversationSummary> = {}
  if (!isRecord(value)) return summaries
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue
    if (typeof raw.summary === 'string' && typeof raw.time === 'number') summaries[key] = {
      summary: raw.summary,
      time: raw.time,
    }
  }
  return summaries
}

function readWebQQStoredUnreadCounts(value: unknown) {
  const counts: Record<string, number> = {}
  if (!isRecord(value)) return counts
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === 'number' && count > 0) counts[key] = count
  }
  return counts
}

function readWebQQStoredHiddenRecentKeys(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.includes(':')))]
}

function readWebQQStoredState(value: unknown): WebQQStoredState {
  const empty = createEmptyWebQQStoredState()
  if (!isRecord(value)) return empty
  return {
    conversationSummaries: readWebQQStoredConversationSummaries(value.conversationSummaries),
    conversationUnreadCounts: readWebQQStoredUnreadCounts(value.conversationUnreadCounts),
    hiddenRecentKeys: readWebQQStoredHiddenRecentKeys(value.hiddenRecentKeys),
  }
}

async function loadDatabaseWebQQStorage(ctx: WebQQStorageContext, scopeId?: string) {
  const database = getWebQQDatabase(ctx)
  const [row] = await database.get(chatCapsuleStorageTable, { id: getWebQQStateStorageId(scopeId) })
  return readWebQQStoredState(isRecord(row) ? row.payload : undefined)
}

async function saveDatabaseWebQQStorage(ctx: WebQQStorageContext, state: WebQQStoredState, scopeId?: string) {
  const database = getWebQQDatabase(ctx)
  await database.upsert(chatCapsuleStorageTable, [{
    id: getWebQQStateStorageId(scopeId),
    payload: state,
    updatedAt: new Date(),
  }])
}

export async function loadWebQQStorage(ctx: WebQQStorageContext, config: Config, scopeId?: string): Promise<WebQQStoredState> {
  if (readConfigValue(config, 'webQQStorageBackend') === 'database') return loadDatabaseWebQQStorage(ctx, scopeId)
  return createEmptyWebQQStoredState()
}

export async function saveWebQQStorage(ctx: WebQQStorageContext, config: Config, state: WebQQStoredState, scopeId?: string): Promise<void> {
  const normalized = readWebQQStoredState(state)
  if (readConfigValue(config, 'webQQStorageBackend') === 'database') {
    await saveDatabaseWebQQStorage(ctx, normalized, scopeId)
  }
}
