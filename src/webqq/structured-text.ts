import { isRecord, readRecordText } from '../shared/record'

export function readStructuredText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(readStructuredText).join('')
  if (!isRecord(value)) return ''
  if (value.content !== undefined && value.content !== value) return readStructuredText(value.content)
  if (value.text !== undefined) return readStructuredText(value.text)
  if (Array.isArray(value.children)) return readStructuredText(value.children)
  if (isRecord(value.attrs)) return readRecordText(value.attrs, ['content', 'text'])
  if (isRecord(value.kwargs)) return readStructuredText(value.kwargs)
  if (isRecord(value.lc_kwargs)) return readStructuredText(value.lc_kwargs)
  return ''
}
