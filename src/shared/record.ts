export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function readRecordText(source: unknown, keys: string[]) {
  if (!isRecord(source)) return ''
  for (const key of keys) {
    const value = source[key]
    if (value != null && String(value).trim()) return String(value)
  }
  return ''
}
