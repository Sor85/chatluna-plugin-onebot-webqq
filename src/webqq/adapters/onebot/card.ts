import { getStringField, isRecord } from '../../../onebot/data'
import type { WebQQMessageElement } from '../../types'

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value
  if (typeof value !== 'string') return
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function getCardMeta(payload: Record<string, unknown>) {
  const meta = isRecord(payload.meta) ? payload.meta : undefined
  if (!meta) return undefined
  const view = getStringField(payload, ['view'])
  if (view && isRecord(meta[view])) return meta[view]
  return Object.values(meta).find(isRecord)
}

export function normalizeCardElement(data: Record<string, unknown>): WebQQMessageElement {
  const payload = parseJsonRecord(data.data) ||
    parseJsonRecord(data.content) ||
    parseJsonRecord(data.json) ||
    parseJsonRecord(data)
  const meta = payload ? getCardMeta(payload) : undefined
  const card = meta ?? payload ?? data
  const title = getStringField(card, ['title']) ||
    (payload ? getStringField(payload, ['title', 'prompt']) : '') ||
    '卡片消息'
  const text = getStringField(card, ['desc', 'summary', 'content']) ||
    (payload ? getStringField(payload, ['desc', 'prompt']) : '') ||
    '[卡片消息]'
  const url = getStringField(card, ['jumpUrl', 'jump_url', 'url', 'source_url'])
  const imageUrl = getStringField(card, ['preview', 'image', 'imageUrl', 'image_url', 'picUrl', 'pic_url', 'icon', 'source_icon'])
  const source = getStringField(card, ['tag', 'source', 'app'])
  return {
    type: 'card',
    title,
    text,
    ...(url ? { url } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(source ? { source } : {}),
  }
}
