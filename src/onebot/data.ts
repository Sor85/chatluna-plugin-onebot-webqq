import { isRecord, readRecordText } from '../shared/record'

export { isRecord }

export function getStringField(source: Record<string, unknown>, keys: string[]) {
  return readRecordText(source, keys)
}

export function getNumberField(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(source[key])
    if (Number.isFinite(value)) return value
  }
  return 0
}

export function getBooleanField(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key]
    if (value === true || value === 'true' || value === 1) return true
    if (value === false || value === 'false' || value === 0) return false
  }
  return undefined
}

export function toOneBotId(value: string) {
  // SnowLuma 的 message_id 是常为负数的 int32 哈希，同样要按数字传。
  return /^-?\d+$/.test(value) ? Number(value) : value
}

export function toTimestampMs(value: unknown) {
  const time = Number(value) || 0
  return time > 100000000000 ? time : time * 1000
}

export function toArrayResult(result: unknown, key: string) {
  if (Array.isArray(result)) return result
  if (!isRecord(result)) return []
  if (Array.isArray(result[key])) return result[key]
  if (isRecord(result.data) && Array.isArray(result.data[key])) return result.data[key]
  if (Array.isArray(result.data)) return result.data
  return []
}

export function getActionData(result: unknown) {
  const item = isRecord(result) ? result : {}
  return isRecord(item.data) ? item.data : item
}
