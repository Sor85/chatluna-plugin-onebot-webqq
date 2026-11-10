import type { WebQQMessage, WebQQMessageSearchQuery, WebQQMessageSearchResult } from './types'

function getMessageSearchText(message: WebQQMessage) {
  return [
    message.senderName,
    message.summary,
    ...message.elements.flatMap((element) => [element.title, element.text, element.transcript, element.source]),
  ].filter(Boolean).join('\n').toLocaleLowerCase()
}

function parseSearchBoundary(value?: string) {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : timestamp
}

function getSearchMessageKey(message: WebQQMessage) {
  return message.id || message.sequence
}

async function raceWebQQSearchTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise.then((value) => ({ timedOut: false as const, value })),
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function filterWebQQSearchMessages(
  messages: WebQQMessage[],
  query: Pick<WebQQMessageSearchQuery, 'keyword' | 'createdAtStart' | 'createdAtEnd'>,
) {
  const keyword = query.keyword.trim().toLocaleLowerCase()
  const createdAtStart = parseSearchBoundary(query.createdAtStart)
  const createdAtEnd = parseSearchBoundary(query.createdAtEnd)
  if (!keyword && createdAtStart == null && createdAtEnd == null) return []
  return messages.filter((message) => {
    const messageTime = new Date(message.time).getTime()
    const matchesKeyword = !keyword || getMessageSearchText(message).includes(keyword)
    const matchesStart = createdAtStart == null || messageTime >= createdAtStart
    const matchesEnd = createdAtEnd == null || messageTime < createdAtEnd
    return matchesKeyword && matchesStart && matchesEnd
  })
}

export async function searchWebQQMessageHistory(
  query: WebQQMessageSearchQuery,
  options: {
    pageSize: number
    maxPages: number
    loadMessages: (query: { type: WebQQMessageSearchQuery['type']; peerId: string; limit: number; beforeSequence?: string }) => Promise<WebQQMessage[]>
    loadCachedMessages?: () => Promise<WebQQMessage[]>
    pageTimeoutMs?: number
    searchTimeoutMs?: number
    /** 短页不代表到头：SnowLuma 按 30 个序号一窗翻群历史，撤回或缺失的序号会让一页变短。 */
    shortPageMayContinue?: boolean
  },
): Promise<WebQQMessageSearchResult> {
  const keyword = query.keyword.trim().toLocaleLowerCase()
  const createdAtStart = parseSearchBoundary(query.createdAtStart)
  const createdAtEnd = parseSearchBoundary(query.createdAtEnd)
  if (!keyword && createdAtStart == null && createdAtEnd == null) {
    return { messages: [], scannedCount: 0, exhausted: true }
  }

  const messages: WebQQMessage[] = []
  const seenMessageKeys = new Set<string>()
  let scannedCount = 0
  let beforeSequence = query.beforeSequence
  let exhausted = false

  const ingest = (page: WebQQMessage[]) => {
    let freshCount = 0
    for (const message of page) {
      const key = getSearchMessageKey(message)
      if (key && seenMessageKeys.has(key)) continue
      if (key) seenMessageKeys.add(key)
      freshCount++
      scannedCount++
      const messageTime = new Date(message.time).getTime()
      const matchesKeyword = !keyword || getMessageSearchText(message).includes(keyword)
      const matchesStart = createdAtStart == null || messageTime >= createdAtStart
      const matchesEnd = createdAtEnd == null || messageTime < createdAtEnd
      if (matchesKeyword && matchesStart && matchesEnd) messages.push(message)
    }
    return freshCount
  }

  // 先扫本会话已持久化/内存里的记录。生产里 OneBot 历史接口经常比本地缓存更短或更不稳，
  // 用户刚滑过的消息必须能搜到；缓存不够覆盖更早记录时，再继续向 OneBot 翻页。
  if (!query.beforeSequence && options.loadCachedMessages) {
    const cached = await options.loadCachedMessages()
    ingest([...cached].sort((left, right) => right.time - left.time))
  }

  const pageTimeoutMs = options.pageTimeoutMs ?? 4000
  const searchTimeoutMs = options.searchTimeoutMs ?? 8000
  const searchStartedAt = Date.now()

  for (let pageIndex = 0; pageIndex < options.maxPages; pageIndex++) {
    const remainingMs = searchTimeoutMs - (Date.now() - searchStartedAt)
    // 生产里 get_*_msg_history 可能一直不回；不能让整次搜索 RPC 无限转圈。
    if (remainingMs <= 0) {
      exhausted = !beforeSequence
      break
    }
    const pageResult = await raceWebQQSearchTimeout(options.loadMessages({
      type: query.type,
      peerId: query.peerId,
      limit: options.pageSize,
      ...(beforeSequence ? { beforeSequence } : {}),
    }), Math.min(pageTimeoutMs, remainingMs))
    if (pageResult.timedOut) {
      exhausted = !beforeSequence
      break
    }
    const page = pageResult.value
    if (!page.length) {
      exhausted = true
      break
    }

    ingest(page)
    const nextBeforeSequence = page[0]?.sequence
    // 部分 OneBot 实现会重复返回边界消息；游标不前进时必须停止，避免搜索请求无限循环。
    // 首页若已全部出现在本地缓存里，freshCount 会是 0，但游标仍应继续向更早的历史翻页。
    if (!nextBeforeSequence || nextBeforeSequence === beforeSequence) {
      exhausted = true
      break
    }
    beforeSequence = nextBeforeSequence
    if (!options.shortPageMayContinue && page.length < options.pageSize) {
      exhausted = true
      break
    }
  }

  return {
    messages,
    scannedCount,
    exhausted,
    ...(!exhausted && beforeSequence ? { nextBeforeSequence: beforeSequence } : {}),
  }
}
