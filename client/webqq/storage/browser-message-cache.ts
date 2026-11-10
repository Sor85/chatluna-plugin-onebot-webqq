import type { WebQQMessage } from '../types'

const webQQMessageCacheStoreName = 'messages'
let webQQMessageCacheDatabase: IDBDatabase | undefined

function createWebQQMessageCacheKey(type: string, peerId: string, scopeId?: string) {
  const key = `${type}:${peerId}`
  return scopeId ? `${key}:${scopeId}` : key
}

function openWebQQMessageCacheDatabase(): Promise<IDBDatabase> {
  if (webQQMessageCacheDatabase) return Promise.resolve(webQQMessageCacheDatabase)
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('onebot-webqq-webqq', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      webQQMessageCacheDatabase = request.result
      resolve(request.result)
    }
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(webQQMessageCacheStoreName)) {
        database.createObjectStore('messages', { keyPath: 'id' })
      }
    }
  })
}

function readCachedMessages(value: unknown) {
  if (!value || typeof value !== 'object') return []
  const messages = Reflect.get(value, 'messages')
  return Array.isArray(messages) ? messages.filter((message) => message && typeof message === 'object') as WebQQMessage[] : []
}

// 读取当前浏览器里指定 WebQQ 会话的消息缓存。
export async function loadBrowserWebQQMessages(type: string, peerId: string, scopeId?: string): Promise<WebQQMessage[]> {
  try {
    const database = await openWebQQMessageCacheDatabase()
    return await new Promise((resolve) => {
      const transaction = database.transaction(webQQMessageCacheStoreName, 'readonly')
      const store = transaction.objectStore(webQQMessageCacheStoreName)
      const request = store.get(createWebQQMessageCacheKey(type, peerId, scopeId))
      request.onsuccess = () => resolve(readCachedMessages(request.result))
      request.onerror = () => resolve([])
    })
  } catch {
    return []
  }
}

// 保存当前浏览器里指定 WebQQ 会话的最近消息缓存。
export async function saveBrowserWebQQMessages(type: string, peerId: string, messages: WebQQMessage[], limit: number, scopeId?: string): Promise<void> {
  try {
    const database = await openWebQQMessageCacheDatabase()
    const cachedMessages = messages.slice(-limit)
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(webQQMessageCacheStoreName, 'readwrite')
      const store = transaction.objectStore(webQQMessageCacheStoreName)
      const request = store.put({
        id: createWebQQMessageCacheKey(type, peerId, scopeId),
        messages: cachedMessages,
        updatedAt: Date.now(),
      })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch {}
}
