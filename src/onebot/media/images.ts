import { callAction, type OneBotBot } from '../actions'
import { getStringField, isRecord } from '../data'

type OneBotImageUrlResolver = (file: string, options?: { refresh?: () => Promise<string> }) => string

const unsafeFileScheme = /^[a-z][a-z0-9+.-]*:/i
const windowsAbsolutePath = /^[a-z]:[\\/]/i

export function assertSafeOneBotMediaFile(file: string) {
  const normalized = file.trim().replace(/\\/g, '/')
  if (!normalized ||
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.endsWith('/..') ||
    windowsAbsolutePath.test(file) ||
    unsafeFileScheme.test(file)) {
    throw new Error('不安全的 OneBot 媒体文件标识')
  }
}

function resolveImageSource(result: unknown) {
  const item = isRecord(result) ? result : {}
  const source = isRecord(item.data) ? item.data : item
  const url = getStringField(source, ['url'])
  if (url) return url
  const file = getStringField(source, ['file', 'path'])
  return file || ''
}

function resolveImageUrl(result: unknown, imageUrlResolver?: OneBotImageUrlResolver, refresh?: () => Promise<string>) {
  const file = resolveImageSource(result)
  if (!file) return ''
  return imageUrlResolver?.(file, refresh ? { refresh } : undefined) || file
}

function readImageDebug(result: unknown) {
  const item = isRecord(result) ? result : {}
  if (isRecord(item.data)) {
    return {
      url: getStringField(item.data, ['url']),
      file: getStringField(item.data, ['file', 'path']),
    }
  }
  return {
    url: getStringField(item, ['url']),
    file: getStringField(item, ['file', 'path']),
  }
}

export async function resolveOneBotImage(bot: OneBotBot, file: string, imageUrlResolver?: OneBotImageUrlResolver) {
  // get_image 的 file 应该是 OneBot 文件 ID；拒绝路径和 scheme，避免上层输入被适配器当成本地文件读取。
  assertSafeOneBotMediaFile(file)
  const result = await callAction(bot, 'get_image', { file })
  const refresh = imageUrlResolver
    ? async () => resolveImageSource(await callAction(bot, 'get_image', { file }))
    : undefined
  return {
    url: resolveImageUrl(result, imageUrlResolver, refresh),
    debug: readImageDebug(result),
  }
}
