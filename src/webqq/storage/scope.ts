type WebQQMessageStorageQuery = {
  type: string
  peerId: string
}

const webQQStateStorageId = 'state:webqq'

export function getScopedStorageId(id: string, scopeId?: string) {
  return scopeId ? `${id}:${scopeId}` : id
}

export function getWebQQStateStorageId(scopeId?: string) {
  return getScopedStorageId(webQQStateStorageId, scopeId)
}

export function getWebQQMessageStorageId(query: WebQQMessageStorageQuery, scopeId?: string) {
  return getScopedStorageId(`messages:${query.type}:${query.peerId}`, scopeId)
}

export function getWebQQRecalledMessageStorageId(query: WebQQMessageStorageQuery, scopeId?: string) {
  return getScopedStorageId(`recalled-messages:${query.type}:${query.peerId}`, scopeId)
}
