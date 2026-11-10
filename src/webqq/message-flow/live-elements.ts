import type { Session } from '@satorijs/core'
import type { WebQQMessageElement } from '../types'
import { normalizeCardElement } from '../adapters/onebot/card'
import { missingImageElement } from '../adapters/onebot/images'
import { normalizeFaceElement, summarizeElements } from '../adapters/onebot/messages'
import { decodeTextEntity, normalizeMentionMarkupText, readMarkupAttribute } from '../adapters/onebot/text'
import { isRecord, readRecordText } from '../../shared/record'
import { readStructuredText } from '../structured-text'
import { isDirectMediaSource, isRemoteImageSource, isUnresolvableMediaSource } from '../media/image-url-resolver'

function readElementText(value: unknown) {
  return value == null ? '' : String(value)
}

function normalizeLiveQuoteMarkupText(value: string) {
  const source = value.trim()
  if (!source) return ''
  const hasMarkup = /\[CQ:at,[^\]]+\]/i.test(source) ||
    /<(?:[\w-]+:)?(?:msg|at|qqbot-at-user|img|image|mface|file|face|record|audio|video)\b/i.test(source)
  if (!hasMarkup) return normalizeMentionMarkupText(source)

  // 新消息的引用内容可能是 OneBot 适配器塞进 Satori 元素的 XML 文本；
  // 历史消息会先走 segment 解析。这里在引用边界压成摘要，避免 UI 直接露出 XML。
  const normalizedMedia = source
    .replace(/<(?:[\w-]+:)?(?:img|image|mface)\b[^>]*\/?>/gi, '[图片]')
    .replace(/<(?:[\w-]+:)?file\b[^>]*\/?>/gi, (tag: string) =>
      readMarkupAttribute(tag, ['name', 'file']) || '[文件]')
    .replace(/<(?:[\w-]+:)?(?:record|audio)\b[^>]*\/?>/gi, '[语音]')
    .replace(/<(?:[\w-]+:)?video\b[^>]*\/?>/gi, '[视频]')
    .replace(/<(?:[\w-]+:)?face\b[^>]*\/?>/gi, (tag: string) => {
      const id = readMarkupAttribute(tag, ['id', 'face_id', 'emoji_id'])
      return id ? `[表情 ${id}]` : '[表情]'
    })

  return decodeTextEntity(normalizeMentionMarkupText(normalizedMedia))
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export type WebQQResolvedImage = {
  url: string
  debug?: unknown
}

export type WebQQImageResolver = (file: string, source?: 'url') => Promise<WebQQResolvedImage>
export type WebQQQuoteResolver = (id: string) => Promise<WebQQMessageElement>
export type WebQQForwardResolver = (id: string) => Promise<WebQQMessageElement>
export type WebQQRecordResolver = WebQQImageResolver

async function normalizeLiveImageElement(attrs: Record<string, unknown>, resolveImage?: WebQQImageResolver): Promise<WebQQMessageElement> {
  const url = readElementText(attrs.src || attrs.url)
  // 浏览器能直接渲染的取值不进代理；取不回的引用不算地址，继续按 file 解析。
  if (isDirectMediaSource(url)) return { type: 'image', url }
  if (url && !isUnresolvableMediaSource(url)) {
    try {
      return { type: 'image', url: resolveImage ? (await resolveImage(url, 'url')).url : url }
    } catch {
      return { type: 'image', url }
    }
  }
  const file = readElementText(attrs.file || attrs.file_id)
  if (!file) return missingImageElement
  if (isDirectMediaSource(file)) return { type: 'image', url: file }
  if (isUnresolvableMediaSource(file)) return missingImageElement
  if (isRemoteImageSource(file)) {
    try {
      return { type: 'image', url: resolveImage ? (await resolveImage(file, 'url')).url : file }
    } catch {
      return { type: 'image', url: file }
    }
  }
  try {
    return { type: 'image', url: resolveImage ? (await resolveImage(file)).url : '' }
  } catch {
    return missingImageElement
  }
}

async function normalizeLiveRecordElement(attrs: Record<string, unknown>, resolveRecord?: WebQQRecordResolver): Promise<WebQQMessageElement> {
  const duration = Number(readElementText(attrs.duration || attrs.time || attrs.seconds)) || 0
  const transcript = readRecordText(attrs, ['text', 'transcript'])
  const base = {
    type: 'record' as const,
    text: '[语音]',
    ...(duration ? { duration } : {}),
    ...(transcript ? { transcript } : {}),
  }
  const url = readElementText(attrs.src || attrs.url || attrs.temp_url)
  if (isDirectMediaSource(url)) return { ...base, url }
  if (url && !isUnresolvableMediaSource(url)) {
    try {
      return { ...base, url: resolveRecord ? (await resolveRecord(url, 'url')).url : url }
    } catch {
      return { ...base, url }
    }
  }
  const file = readElementText(attrs.file || attrs.file_id || attrs.resource_id || attrs.path)
  if (!file) return base
  if (isDirectMediaSource(file)) return { ...base, url: file }
  if (isUnresolvableMediaSource(file)) return base
  try {
    return { ...base, url: resolveRecord ? (await resolveRecord(file)).url : '' }
  } catch {
    return base
  }
}

function readLiveQuoteText(raw: unknown): string {
  if (typeof raw === 'string') return normalizeLiveQuoteMarkupText(raw)
  if (!isRecord(raw)) return ''
  const type = readElementText(raw.type)
  const attrs = isRecord(raw.attrs) ? raw.attrs : {}
  if (type === 'text') return normalizeLiveQuoteMarkupText(readElementText(attrs.content))
  if (type === 'img' || type === 'image') return '[图片]'
  if (type === 'face') return `[表情 ${readElementText(attrs.id)}]`
  if (Array.isArray(raw.children)) return raw.children.map(readLiveQuoteText).join('').trim()
  return normalizeLiveQuoteMarkupText(readElementText(attrs.content || attrs.text))
}

async function normalizeLiveQuoteField(session: Session, resolveQuote?: WebQQQuoteResolver): Promise<WebQQMessageElement | undefined> {
  const quote = session.quote ?? session.event.message?.quote
  if (!isRecord(quote)) return
  const user = isRecord(quote.user) ? quote.user : undefined
  const member = isRecord(quote.member) ? quote.member : undefined
  const title = (member ? readRecordText(member, ['name', 'nick']) : '') ||
    (user ? readRecordText(user, ['name', 'nick', 'id']) : '')
  const text = normalizeLiveQuoteMarkupText(readStructuredText(quote.content)) ||
    (Array.isArray(quote.elements) ? quote.elements.map(readLiveQuoteText).join('').trim() : '')
  const id = readRecordText(quote, ['id', 'messageId', 'message_id'])
  if (!text && id && resolveQuote) {
    try {
      const resolved = await resolveQuote(id)
      return { ...resolved, targetMessageId: resolved.targetMessageId || id }
    } catch {
      return { type: 'quote', text: '[引用消息]', targetMessageId: id }
    }
  }
  return {
    type: 'quote',
    ...(title ? { title } : {}),
    ...(id ? { targetMessageId: id } : {}),
    text: text || '[引用消息]',
  }
}

async function normalizeLiveElement(
  raw: unknown,
  resolveImage?: WebQQImageResolver,
  resolveQuote?: WebQQQuoteResolver,
  resolveForward?: WebQQForwardResolver,
  resolveRecord?: WebQQRecordResolver,
): Promise<WebQQMessageElement | undefined> {
  if (typeof raw === 'string') return { type: 'text', text: raw }
  if (!isRecord(raw)) return undefined
  const type = readElementText(raw.type)
  const attrs = isRecord(raw.attrs) ? raw.attrs : {}
  if (type === 'text') return { type: 'text', text: readElementText(attrs.content) }
  if (type === 'at') {
    const target = readRecordText(attrs, ['name', 'nickname', 'card', 'text', 'content', 'id', 'qq', 'user_id', 'uin'])
    return target ? { type: 'text', text: `@${target}` } : { type: 'unknown', text: '[消息]' }
  }
  if (type === 'quote' || type === 'reply') {
    const title = readElementText(attrs.name || attrs.nickname || attrs.senderName || attrs.sender_name)
    const text = normalizeLiveQuoteMarkupText(readElementText(attrs.content || attrs.text || attrs.sourceMsgText)) ||
      (Array.isArray(attrs.message) ? attrs.message.map(readLiveQuoteText).join('').trim() : '') ||
      (Array.isArray(raw.children) ? raw.children.map(readLiveQuoteText).join('').trim() : '')
    const id = readElementText(attrs.id || attrs.messageId || attrs.message_id)
    if (!text && id && resolveQuote) {
      try {
        const resolved = await resolveQuote(id)
        return { ...resolved, targetMessageId: resolved.targetMessageId || id }
      } catch {
        return { type: 'quote', text: '[引用消息]', targetMessageId: id }
      }
    }
    return {
      type: 'quote',
      ...(title ? { title } : {}),
      ...(id ? { targetMessageId: id } : {}),
      text: text || '[引用消息]',
    }
  }
  if (type === 'img' || type === 'image') return normalizeLiveImageElement(attrs, resolveImage)
  if (type === 'forward') {
    const id = readElementText(attrs.id || attrs.messageId || attrs.message_id || attrs.resid)
    if (!id) return { type: 'forward', title: '合并转发', text: '[合并转发]' }
    if (resolveForward) {
      try {
        return await resolveForward(id)
      } catch {
        return { type: 'forward', title: '合并转发', text: '[合并转发]' }
      }
    }
    return { type: 'forward', title: '合并转发', text: '[合并转发]' }
  }
  if (type === 'json' || type === 'lightapp' || type === 'xml') return normalizeCardElement(attrs)
  if (type === 'mface') {
    if (readRecordText(attrs, ['src', 'url', 'file', 'file_id'])) return normalizeLiveImageElement(attrs, resolveImage)
    return normalizeFaceElement(attrs)
  }
  if (type === 'face') return normalizeFaceElement(attrs)
  if (type === 'file') return { type: 'file', text: readElementText(attrs.name || attrs.file) || '[文件]' }
  if (type === 'audio' || type === 'record') return normalizeLiveRecordElement(attrs, resolveRecord)
  if (type === 'video') return { type: 'video', text: '[视频]' }
  return { type: 'unknown', text: '[消息]' }
}

export async function normalizeLiveElements(
  session: Session,
  resolveImage?: WebQQImageResolver,
  resolveQuote?: WebQQQuoteResolver,
  resolveForward?: WebQQForwardResolver,
  resolveRecord?: WebQQRecordResolver,
): Promise<WebQQMessageElement[]> {
  const quote = await normalizeLiveQuoteField(session, resolveQuote)
  const elements = (await Promise.all((session.elements ?? session.event.message?.elements ?? [])
    .map((element) => normalizeLiveElement(element, resolveImage, resolveQuote, resolveForward, resolveRecord))))
    .filter((element): element is WebQQMessageElement => !!element)
  if (quote) elements.unshift(quote)
  if (elements.length) return elements
  const content = session.content?.trim()
  return content ? [{ type: 'text', text: content }] : [{ type: 'unknown', text: '[消息]' }]
}

export { summarizeElements as summarizeWebQQElements }
