import type { WebQQSendElement } from '../types'

export interface WebQQComposerMentionToken {
  type: 'mention'
  id: string
  name: string
}

export interface WebQQComposerTextToken {
  type: 'text'
  text: string
}

export type WebQQComposerDraftToken = WebQQComposerTextToken | WebQQComposerMentionToken

export interface WebQQComposerDraft {
  tokens: WebQQComposerDraftToken[]
  tokenIndex: number
  offset: number
}

export interface WebQQMentionCandidate {
  id: string
  name: string
  avatar?: string
  keywords?: string[]
}

export function createEmptyWebQQComposerDraft(): WebQQComposerDraft {
  return { tokens: [{ type: 'text', text: '' }], tokenIndex: 0, offset: 0 }
}

/** 空文本 token 在可编辑区里的光标锚点：DOM 需要一个能落光标的字符，草稿 token 不要它。 */
export const WEBQQ_COMPOSER_CARET_ANCHOR = '​'

const caretAnchorPattern = new RegExp(WEBQQ_COMPOSER_CARET_ANCHOR, 'g')

/**
 * 可编辑区偏移换成草稿 token 偏移：减掉光标之前的锚点。
 * 锚点只存在于 DOM 里，`normalizeWebQQComposerTokens` 会把它从 token 文本剥掉，
 * 不换算就会让 token 偏移比真实光标多出锚点的个数。
 * 反方向不需要换算：锚点只出现在空文本 token 上，那里唯一合法的偏移就是 0。
 */
export function toWebQQComposerTokenOffset(domText: string, domOffset: number) {
  const before = domText.slice(0, Math.max(0, domOffset))
  return before.length - (before.match(caretAnchorPattern)?.length ?? 0)
}

export function isWebQQComposerDraftEmpty(tokens: readonly WebQQComposerDraftToken[]) {
  return !tokens.some((token) => token.type === 'mention' || !!token.text.trim())
}

export function serializeWebQQComposerDraft(tokens: readonly WebQQComposerDraftToken[]): WebQQSendElement[] {
  return tokens.flatMap((token): WebQQSendElement[] => {
    if (token.type === 'mention') return [{ type: 'at', userId: token.id }]
    const text = token.text.replace(/ /g, ' ')
    return text ? [{ type: 'text', text }] : []
  })
}

export function normalizeWebQQComposerTokens(tokens: readonly WebQQComposerDraftToken[]): WebQQComposerDraftToken[] {
  const normalized: WebQQComposerDraftToken[] = []
  for (const token of tokens) {
    if (token.type === 'mention') {
      normalized.push({ ...token })
      continue
    }
    const text = token.text.replace(caretAnchorPattern, '')
    const previous = normalized.at(-1)
    if (previous?.type === 'text') previous.text += text
    else normalized.push({ type: 'text', text })
  }
  if (!normalized.length) return [{ type: 'text', text: '' }]

  const withCarets: WebQQComposerDraftToken[] = []
  normalized.forEach((token, index) => {
    withCarets.push(token)
    if (token.type === 'mention' && (!normalized[index + 1] || normalized[index + 1].type === 'mention')) {
      withCarets.push({ type: 'text', text: '' })
    }
  })
  if (withCarets[0]?.type === 'mention') withCarets.unshift({ type: 'text', text: '' })
  return withCarets
}

function clampTextCaret(tokens: readonly WebQQComposerDraftToken[], tokenIndex: number, offset: number): WebQQComposerDraft {
  let index = Math.min(Math.max(tokenIndex, 0), Math.max(0, tokens.length - 1))
  if (tokens[index]?.type !== 'text') index = tokens.findIndex((token) => token.type === 'text')
  if (index < 0) return createEmptyWebQQComposerDraft()
  const token = tokens[index]
  const text = token?.type === 'text' ? token.text : ''
  return {
    tokens: [...tokens],
    tokenIndex: index,
    offset: Math.min(Math.max(offset, 0), text.length),
  }
}

export function insertWebQQComposerMention(
  tokens: readonly WebQQComposerDraftToken[],
  tokenIndex: number,
  offset: number,
  mention: Omit<WebQQComposerMentionToken, 'type'>,
) {
  return replaceWebQQComposerTextRange(tokens, tokenIndex, offset, offset, mention)
}

export function replaceWebQQComposerTextRange(
  tokens: readonly WebQQComposerDraftToken[],
  tokenIndex: number,
  start: number,
  end: number,
  mention: Omit<WebQQComposerMentionToken, 'type'>,
): WebQQComposerDraft {
  const source = tokens[tokenIndex]?.type === 'text' ? tokens[tokenIndex].text : ''
  const from = Math.max(0, Math.min(start, end, source.length))
  const to = Math.max(from, Math.min(Math.max(start, end), source.length))
  let before = source.slice(0, from)
  const rawAfter = source.slice(to)
  if (before && !/\s$/.test(before)) before += ' '
  const after = rawAfter ? (rawAfter.startsWith(' ') ? rawAfter : ` ${rawAfter}`) : ' '
  const next = normalizeWebQQComposerTokens([
    ...tokens.slice(0, tokenIndex),
    ...(before ? [{ type: 'text' as const, text: before }] : []),
    { type: 'mention', id: mention.id, name: mention.name },
    { type: 'text', text: after },
    ...tokens.slice(tokenIndex + 1),
  ])
  const mentionIndex = next.findIndex((token, index) => (
    index >= tokenIndex && token.type === 'mention' && token.id === mention.id
  ))
  const caretIndex = mentionIndex + 1
  const caretToken = next[caretIndex]
  // 光标越过自动补入的后置空格，继续输入才能得到“@用户 内容”，而不是把正文粘到 mention token 上。
  const caretOffset = caretToken?.type === 'text' && /^[  ]/.test(caretToken.text) ? 1 : 0
  return clampTextCaret(next, caretIndex, caretOffset)
}

export function detectWebQQMentionTrigger(text: string, caretOffset: number) {
  const prefix = text.slice(0, caretOffset)
  const match = /(^|[^\s@])?@([^\s@]*)$/.exec(prefix)
  return match ? { query: match[2], start: caretOffset - match[2].length - 1 } : null
}

function getCandidateSearchTexts(candidate: WebQQMentionCandidate) {
  return [candidate.name, candidate.id, ...(candidate.keywords ?? [])]
}

export function filterWebQQMentionCandidates(candidates: readonly WebQQMentionCandidate[], query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  return [...candidates]
    .filter((candidate) => !normalized || getCandidateSearchTexts(candidate).some((text) => text.toLocaleLowerCase().includes(normalized)))
    .sort((left, right) => {
      const leftPrefix = getCandidateSearchTexts(left).some((text) => text.toLocaleLowerCase().startsWith(normalized))
      const rightPrefix = getCandidateSearchTexts(right).some((text) => text.toLocaleLowerCase().startsWith(normalized))
      return Number(rightPrefix) - Number(leftPrefix) || left.name.localeCompare(right.name, 'zh-Hans') || left.id.localeCompare(right.id)
    })
}
