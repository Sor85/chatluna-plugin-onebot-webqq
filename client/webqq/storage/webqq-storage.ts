import { invoke } from '../../runtime'
import { readStored, writeStored } from '@chatluna/ui-storage'
import type { WebQQStorageBackend } from '../../../src/config/spec'
import type { WebQQConversationSummary, WebQQMessage, WebQQStoredState } from '../types'
import { loadBrowserWebQQMessages, saveBrowserWebQQMessages } from './browser-message-cache'

const webQQStorageKey = 'chatluna.onebot-webqq.webqq-state'

function getScopedStorageKey(key: string, scopeId?: string) {
  return scopeId ? `${key}:${scopeId}` : key
}

function readStoredConversationSummaries(value: unknown) {
  const summaries: Record<string, WebQQConversationSummary> = {}
  if (!value || typeof value !== 'object') return summaries
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object') continue
    const summary = Reflect.get(raw, 'summary')
    const time = Reflect.get(raw, 'time')
    if (typeof summary === 'string' && typeof time === 'number') summaries[key] = { summary, time }
  }
  return summaries
}

function readStoredUnreadCounts(value: unknown) {
  const counts: Record<string, number> = {}
  if (!value || typeof value !== 'object') return counts
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === 'number' && count > 0) counts[key] = count
  }
  return counts
}

function readStoredHiddenRecentKeys(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.includes(':')))]
}

function createEmptyWebQQStoredState(): WebQQStoredState {
  return {
    conversationSummaries: {},
    conversationUnreadCounts: {},
    hiddenRecentKeys: [],
  }
}

function normalizeWebQQStoredState(value: unknown): WebQQStoredState {
  if (!value || typeof value !== 'object') return createEmptyWebQQStoredState()
  return {
    conversationSummaries: readStoredConversationSummaries(Reflect.get(value, 'conversationSummaries')),
    conversationUnreadCounts: readStoredUnreadCounts(Reflect.get(value, 'conversationUnreadCounts')),
    hiddenRecentKeys: readStoredHiddenRecentKeys(Reflect.get(value, 'hiddenRecentKeys')),
  }
}

export function loadBrowserWebQQStoredState(storageBackend: WebQQStorageBackend, scopeId?: string): WebQQStoredState {
  const empty = createEmptyWebQQStoredState()
  if (storageBackend !== 'browser') return empty
  return normalizeWebQQStoredState(readStored(getScopedStorageKey(webQQStorageKey, scopeId)))
}

export function persistWebQQStoredState(storageBackend: WebQQStorageBackend, state: WebQQStoredState, scopeId?: string) {
  if (storageBackend !== 'browser') {
    invoke('onebot-webqq.storage.save', state).catch(() => {})
    return
  }
  writeStored(getScopedStorageKey(webQQStorageKey, scopeId), state)
}

export async function loadRemoteWebQQStoredState(storageBackend: WebQQStorageBackend) {
  if (storageBackend === 'browser') return
  try {
    return normalizeWebQQStoredState(await invoke('onebot-webqq.storage.load'))
  } catch {
    return
  }
}

function normalizeCachedWebQQMessages(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((message) => message && typeof message === 'object') as WebQQMessage[]
}

export async function loadCachedWebQQMessages(type: 'friend' | 'group', peerId: string, storageBackend: WebQQStorageBackend, scopeId?: string) {
  if (storageBackend === 'database') {
    try {
      return normalizeCachedWebQQMessages(await invoke('onebot-webqq.messages.cache.load', { type, peerId }))
    } catch {
      return []
    }
  }
  return loadBrowserWebQQMessages(type, peerId, scopeId)
}

export async function saveCachedWebQQMessages(type: 'friend' | 'group', peerId: string, messages: WebQQMessage[], storageBackend: WebQQStorageBackend, messageCacheLimit: number, scopeId?: string) {
  const cachedMessages = messages.slice(-messageCacheLimit)
  if (storageBackend === 'database') {
    await invoke('onebot-webqq.messages.cache.save', { type, peerId, messages: cachedMessages }).catch(() => {})
    return
  }
  await saveBrowserWebQQMessages(type, peerId, cachedMessages, messageCacheLimit, scopeId)
}
