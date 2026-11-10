import * as React from 'react'
import { IconX } from '@tabler/icons-react'
import { useT } from '../../i18n'
import type { WebQQComposerMentionRequest, WebQQComposerSubmitResult } from '../controller'
import type { WebQQSendElement } from '../types'
import { useWebQQScrollbar } from '../utils/webqq-scrollbar'
import {
  createEmptyWebQQComposerDraft,
  detectWebQQMentionTrigger,
  filterWebQQMentionCandidates,
  insertWebQQComposerMention,
  isWebQQComposerDraftEmpty,
  normalizeWebQQComposerTokens,
  replaceWebQQComposerTextRange,
  serializeWebQQComposerDraft,
  toWebQQComposerTokenOffset,
  WEBQQ_COMPOSER_CARET_ANCHOR,
  type WebQQComposerDraft,
  type WebQQComposerDraftToken,
  type WebQQMentionCandidate,
} from '../utils/webqq-composer-draft'

/** 输入区上方回复条要展示的内容；回复目标本身归会话层持有。 */
export interface WebQQComposerReplyTarget {
  senderName: string
  summary: string
}

type WebQQSendFileKind = 'image' | 'video' | 'file'

interface WebQQSendFile {
  id: string
  file: File
  kind: WebQQSendFileKind
  previewUrl?: string
  baseName: string
  extension: string
}

const webQQVideoFileExtensions = new Set(['mp4', 'webm', 'mov', 'm4v', '3gp'])

function getSendFileNameParts(name: string) {
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex <= 0) return { baseName: name, extension: '' }
  return { baseName: name.slice(0, dotIndex), extension: name.slice(dotIndex) }
}

function getSendFileKind(file: File): WebQQSendFileKind {
  const mime = file.type.toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  // Firefox 与部分系统文件选择器可能不提供 MIME；仅对 QQ 常见可播放格式回退，
  // 避免把不受支持的视频容器误发为原生视频消息。
  return webQQVideoFileExtensions.has(extension) ? 'video' : 'file'
}

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

async function toSendElement(file: File): Promise<WebQQSendElement> {
  return {
    type: getSendFileKind(file),
    data: `data:${file.type || 'application/octet-stream'};base64,${toBase64(await file.arrayBuffer())}`,
    name: file.name,
  }
}

/** 可编辑区的直接子节点里，只有文本节点和提及节点对应草稿 token；其余节点不参与 token 计数。 */
function isComposerTokenNode(node: Node) {
  return node.nodeType === Node.TEXT_NODE || (node instanceof HTMLElement && !!node.dataset.mentionId)
}

function MentionMenu(props: { candidates: WebQQMentionCandidate[], activeIndex: number, onSelect: (candidate: WebQQMentionCandidate) => void, onHover: (index: number) => void }) {
  const t = useT()
  return (
    <div className="onebot-webqq-webqq__mention-menu" role="listbox" aria-label={t('webqq.composer.mentionMenu')}>
      {props.candidates.map((candidate, index) => (
        <button
          key={candidate.id}
          type="button"
          className={['onebot-webqq-webqq__mention-menu-item', index === props.activeIndex ? 'is-active' : ''].filter(Boolean).join(' ')}
          role="option"
          aria-selected={index === props.activeIndex}
          onMouseDown={(event) => {
            event.preventDefault()
            props.onSelect(candidate)
          }}
          onMouseEnter={() => props.onHover(index)}
        >
          {candidate.avatar
            ? <img className="onebot-webqq-webqq__mention-menu-avatar" src={candidate.avatar} alt="" />
            : <span className="onebot-webqq-webqq__mention-menu-avatar" aria-hidden="true">{candidate.name.slice(0, 1)}</span>}
          <span className="onebot-webqq-webqq__mention-menu-meta">
            <strong>{candidate.name}</strong>
            <small>{candidate.id}</small>
          </span>
        </button>
      ))}
      {!props.candidates.length ? <div className="onebot-webqq-webqq__mention-menu-empty">{t('webqq.composer.noMentionMatch')}</div> : null}
    </div>
  )
}

/**
 * 发送区：可编辑区直接操作 DOM（提及是不可编辑的整块节点，草稿 token 与 DOM 双向同步），
 * React 不渲染它的子节点。输入区只产出可发送内容，会话、回复目标与发送请求归会话层。
 */
export function WebQQComposer(props: {
  visible: boolean
  sending: boolean
  mentionCandidates: WebQQMentionCandidate[]
  chatKey: string
  botAvatar?: string
  replyingTo?: WebQQComposerReplyTarget
  mentionRequest?: WebQQComposerMentionRequest
  onMentionRequestConsumed: () => void
  onSubmit: (buildElements: () => Promise<WebQQSendElement[]>, complete: (result: WebQQComposerSubmitResult) => void) => void
  onClearReply: () => void
  onPreviewAttachment: (url: string) => void
  onSendSpaceChange: (space: number) => void
}) {
  const t = useT()
  const draft = React.useRef<WebQQComposerDraft>(createEmptyWebQQComposerDraft())
  const [draftEmpty, setDraftEmpty] = React.useState(true)
  const [sendFiles, setSendFiles] = React.useState<WebQQSendFile[]>([])
  const sendFilesRef = React.useRef(sendFiles)
  sendFilesRef.current = sendFiles
  const editor = React.useRef<HTMLDivElement | null>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const form = React.useRef<HTMLFormElement>(null)
  const context = React.useRef<HTMLDivElement>(null)
  const [sendHeight, setSendHeight] = React.useState(44)
  const composing = React.useRef(false)
  const [mentionMenu, setMentionMenu] = React.useState<{ tokenIndex: number, start: number, query: string }>()
  const [mentionMenuIndex, setMentionMenuIndex] = React.useState(0)
  const suppressInput = React.useRef(false)
  const scrollbar = useWebQQScrollbar<HTMLDivElement>({ tone: 'accent' })
  const propsRef = React.useRef(props)
  propsRef.current = props

  const mentionMenuOpen = !!mentionMenu && !!props.mentionCandidates.length
  const filteredMentionCandidates = React.useMemo(
    () => mentionMenu ? filterWebQQMentionCandidates(props.mentionCandidates, mentionMenu.query) : [],
    [mentionMenu, props.mentionCandidates],
  )
  const canSend = !draftEmpty || !!sendFiles.length

  const setDraft = (next: WebQQComposerDraft) => {
    draft.current = next
    setDraftEmpty(isWebQQComposerDraftEmpty(next.tokens))
  }

  const closeMentionMenu = () => {
    setMentionMenu(undefined)
    setMentionMenuIndex(0)
  }

  const renderComposerDraft = (current: WebQQComposerDraft) => {
    const element = editor.current
    if (!element) return
    suppressInput.current = true
    element.replaceChildren()
    for (const token of current.tokens) {
      if (token.type === 'text') {
        // 空文本 token 用零宽字符提供可点击的光标锚点；读回草稿时会统一移除。
        element.appendChild(document.createTextNode(token.text || WEBQQ_COMPOSER_CARET_ANCHOR))
        continue
      }
      const mention = document.createElement('span')
      mention.className = 'onebot-webqq-webqq__composer-mention'
      mention.contentEditable = 'false'
      mention.dataset.mentionId = token.id
      mention.dataset.mentionName = token.name
      mention.textContent = `@${token.name}`
      element.appendChild(mention)
    }
    if (!element.childNodes.length) element.appendChild(document.createTextNode(''))
    suppressInput.current = false
  }

  const getComposerCaret = (tokens = draft.current.tokens) => {
    const element = editor.current
    const selection = window.getSelection()
    if (!element || !selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!element.contains(range.startContainer)) return
    if (range.startContainer === element) {
      let tokenIndex = 0
      for (let childIndex = 0; childIndex < element.childNodes.length; childIndex += 1) {
        const child = element.childNodes[childIndex]!
        if (childIndex === range.startOffset) {
          if (child.nodeType === Node.TEXT_NODE) return { tokenIndex, offset: 0 }
          return { tokenIndex: Math.max(0, tokenIndex - 1), offset: Number.MAX_SAFE_INTEGER }
        }
        if (isComposerTokenNode(child)) tokenIndex += 1
      }
      return { tokenIndex: Math.max(0, tokens.length - 1), offset: Number.MAX_SAFE_INTEGER }
    }
    let tokenIndex = Math.max(0, tokens.length - 1)
    let index = 0
    for (const child of Array.from(element.childNodes)) {
      if (child === range.startContainer || child.contains(range.startContainer)) {
        tokenIndex = index
        break
      }
      if (isComposerTokenNode(child)) index += 1
    }
    // DOM 偏移里可能夹着零宽锚点，必须换算成 token 偏移；否则光标停在文字中间时会多算 1。
    let offset = range.startContainer.nodeType === Node.TEXT_NODE
      ? toWebQQComposerTokenOffset(range.startContainer.textContent ?? '', range.startOffset)
      : 0
    const token = tokens[tokenIndex]
    if (token?.type === 'text') {
      offset = Math.min(Math.max(offset, 0), token.text.length)
    } else {
      tokenIndex = Math.min(tokenIndex + 1, tokens.length - 1)
      offset = 0
    }
    return { tokenIndex, offset }
  }

  const setComposerCaret = (tokenIndex: number, offset: number) => {
    const element = editor.current
    const selection = window.getSelection()
    if (!element || !selection) return
    let index = 0
    let targetNode: Node | undefined
    let targetOffset = 0
    for (const child of Array.from(element.childNodes)) {
      if (!isComposerTokenNode(child)) continue
      if (index === tokenIndex) {
        if (child.nodeType === Node.TEXT_NODE) {
          targetNode = child
          targetOffset = Math.min(Math.max(offset, 0), child.textContent?.length ?? 0)
        } else {
          const next = child.nextSibling
          targetNode = next?.nodeType === Node.TEXT_NODE ? next : child
        }
        break
      }
      index += 1
    }
    if (!targetNode) {
      targetNode = element
      targetOffset = element.childNodes.length
    }
    const range = document.createRange()
    try {
      range.setStart(targetNode, targetOffset)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    } catch {
      // Chrome 与 Firefox 在节点刚替换时都可能暂时拒绝 setStart；下次输入会重新同步光标。
    }
  }

  const applyComposerDraft = (next: WebQQComposerDraft, options: { focus?: boolean } = {}) => {
    const normalized = { tokens: normalizeWebQQComposerTokens(next.tokens), tokenIndex: next.tokenIndex, offset: next.offset }
    setDraft(normalized)
    renderComposerDraft(normalized)
    if (options.focus === false) return
    requestAnimationFrame(() => {
      editor.current?.focus()
      setComposerCaret(normalized.tokenIndex, normalized.offset)
    })
  }

  const readComposerDraftFromDom = (): WebQQComposerDraft => {
    const element = editor.current
    if (!element) return createEmptyWebQQComposerDraft()
    const tokens: WebQQComposerDraftToken[] = []
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        tokens.push({ type: 'text', text: node.textContent ?? '' })
        return
      }
      if (!(node instanceof HTMLElement)) return
      if (node.dataset.mentionId) {
        tokens.push({
          type: 'mention',
          id: node.dataset.mentionId,
          name: node.dataset.mentionName || node.textContent?.replace(/^@/, '') || node.dataset.mentionId,
        })
        return
      }
      if (node.tagName === 'BR') {
        tokens.push({ type: 'text', text: '\n' })
        return
      }
      node.childNodes.forEach(walk)
    }
    element.childNodes.forEach(walk)
    return { tokens: normalizeWebQQComposerTokens(tokens), tokenIndex: draft.current.tokenIndex, offset: draft.current.offset }
  }

  /** 把草稿光标同步到可编辑区里的真实光标；读不到光标时返回 false。 */
  const syncComposerCaretFromDom = () => {
    const caret = getComposerCaret()
    if (!caret) return false
    const token = draft.current.tokens[caret.tokenIndex]
    draft.current = {
      ...draft.current,
      tokenIndex: caret.tokenIndex,
      offset: token?.type === 'text' ? Math.min(caret.offset, token.text.length) : 0,
    }
    return true
  }

  const updateMentionMenuFromDraft = (current: WebQQComposerDraft) => {
    if (!propsRef.current.mentionCandidates.length || composing.current) {
      closeMentionMenu()
      return
    }
    const token = current.tokens[current.tokenIndex]
    const trigger = token?.type === 'text' ? detectWebQQMentionTrigger(token.text, current.offset) : undefined
    if (!trigger) {
      closeMentionMenu()
      return
    }
    setMentionMenu({ tokenIndex: current.tokenIndex, start: trigger.start, query: trigger.query })
    setMentionMenuIndex(0)
  }

  const handleComposerInput = () => {
    if (suppressInput.current) return
    const next = readComposerDraftFromDom()
    // 当前 DOM 已经包含新输入，光标必须按 next.tokens 限制，否则中途键入的 @ 会被截到光标之后。
    const caret = getComposerCaret(next.tokens)
    setDraft({ tokens: next.tokens, tokenIndex: caret?.tokenIndex ?? next.tokenIndex, offset: caret?.offset ?? next.offset })
    updateMentionMenuFromDraft(draft.current)
    // contenteditable 的 input 可能早于 Selection 更新，下一微任务必须重新读取真实光标。
    queueMicrotask(() => {
      if (syncComposerCaretFromDom()) updateMentionMenuFromDraft(draft.current)
    })
  }

  const selectMentionCandidate = (candidate: WebQQMentionCandidate) => {
    if (!mentionMenu) return
    const token = draft.current.tokens[mentionMenu.tokenIndex]
    const end = token?.type === 'text' ? draft.current.offset : mentionMenu.start
    applyComposerDraft(replaceWebQQComposerTextRange(draft.current.tokens, mentionMenu.tokenIndex, mentionMenu.start, Math.max(mentionMenu.start, end), candidate))
    closeMentionMenu()
  }

  const clearSendFiles = () => {
    for (const file of sendFilesRef.current) {
      if (file.previewUrl) URL.revokeObjectURL(file.previewUrl)
    }
    setSendFiles([])
  }

  const addSendFiles = (files: Iterable<File>) => {
    const added = [...files].map((file, index) => {
      const kind = getSendFileKind(file)
      return {
        id: `${file.name}:${file.size}:${file.lastModified}:${sendFilesRef.current.length + index}`,
        file,
        kind,
        previewUrl: kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : undefined,
        ...getSendFileNameParts(file.name),
      }
    })
    setSendFiles((current) => [...current, ...added])
  }

  const removeSendFile = (id: string) => {
    const file = sendFiles.find((item) => item.id === id)
    if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl)
    setSendFiles((current) => current.filter((item) => item.id !== id))
  }

  // 交出去的是待调用的构造器而不是现成的元素：附件转字节可能失败，必须和发送请求落在会话层同一个 try 里，
  // 才能沿用同一句错误文案，并且在转字节之前就先拿到发送锁。
  const buildSubmitElements = async (): Promise<WebQQSendElement[]> => [
    ...serializeWebQQComposerDraft(draft.current.tokens),
    ...await Promise.all(sendFilesRef.current.map(({ file }) => toSendElement(file))),
  ]

  const requestSubmit = () => {
    if (props.sending || !canSend) return
    props.onSubmit(buildSubmitElements, (result) => {
      if (result.sent) {
        applyComposerDraft(createEmptyWebQQComposerDraft(), { focus: false })
        closeMentionMenu()
        clearSendFiles()
      }
      if (!result.restoreFocus) return
      // 必须等 contenteditable 解除禁用后再恢复焦点，否则浏览器会忽略 focus。
      requestAnimationFrame(() => editor.current?.focus())
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (props.sending) {
      event.preventDefault()
      return
    }
    if (mentionMenuOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (!filteredMentionCandidates.length) return
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setMentionMenuIndex((index) => (index + direction + filteredMentionCandidates.length) % filteredMentionCandidates.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const candidate = filteredMentionCandidates[mentionMenuIndex]
        if (candidate) selectMentionCandidate(candidate)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMentionMenu()
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !composing.current) {
      event.preventDefault()
      requestSubmit()
    }
  }

  React.useEffect(() => {
    if (!mentionMenu) return
    setMentionMenuIndex((index) => filteredMentionCandidates.length ? Math.min(index, filteredMentionCandidates.length - 1) : 0)
  }, [filteredMentionCandidates])

  // 切会话时草稿、提及菜单与待发附件必须一起清空：只清草稿会让上一个会话选的附件跟进新会话，回车即误发。
  const firstChatKey = React.useRef(true)
  React.useEffect(() => {
    if (firstChatKey.current) {
      firstChatKey.current = false
      return
    }
    applyComposerDraft(createEmptyWebQQComposerDraft(), { focus: false })
    closeMentionMenu()
    clearSendFiles()
  }, [props.chatKey])

  // 外部提及请求消费后立即回收，同一个成员可以被连续插入；也覆盖「请求早于输入区挂载」的场景。
  React.useEffect(() => {
    const request = props.mentionRequest
    if (!request) return
    syncComposerCaretFromDom()
    const current = draft.current
    const token = current.tokens[current.tokenIndex]
    applyComposerDraft(insertWebQQComposerMention(current.tokens, current.tokenIndex, token?.type === 'text' ? current.offset : 0, request))
    closeMentionMenu()
    props.onMentionRequestConsumed()
  }, [props.mentionRequest])

  // 发送区占位：表单高度加回复与附件那一条的高度，消息区底部按它留白。观察窗隐藏时高度为 0，重新可见后重测。
  React.useLayoutEffect(() => {
    const update = () => {
      const formHeight = form.current ? Math.ceil(form.current.getBoundingClientRect().height) : 44
      const contextHeight = context.current ? Math.ceil(context.current.getBoundingClientRect().height) + 8 : 0
      setSendHeight(formHeight)
      // 回复和附件共用同一个包络，只计一次真实高度，避免两者同时存在时重复撑大消息区留白。
      propsRef.current.onSendSpaceChange(formHeight + contextHeight + 28)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    if (form.current) observer.observe(form.current)
    if (context.current) observer.observe(context.current)
    return () => observer.disconnect()
  }, [props.visible, sendFiles.length, props.replyingTo])

  React.useEffect(() => {
    renderComposerDraft(draft.current)
    return () => {
      for (const file of sendFilesRef.current) {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl)
      }
    }
  }, [])

  const setEditor = React.useCallback((element: HTMLDivElement | null) => {
    editor.current = element
    scrollbar(element)
  }, [scrollbar])

  const removeIcon = (
    <svg className="onebot-webqq-webqq__send-remove-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
  )

  return (
    <form
      ref={form}
      className="onebot-webqq-webqq__send"
      style={{ '--onebot-webqq-webqq-send-height': `${sendHeight}px` } as React.CSSProperties}
      onSubmit={(event) => {
        event.preventDefault()
        requestSubmit()
      }}
    >
      {props.replyingTo || sendFiles.length ? (
        <div ref={context} className="onebot-webqq-webqq__send-context">
          {props.replyingTo ? (
            <div className="onebot-webqq-webqq__reply-draft">
              <span>{t('webqq.composer.replyTo', { name: props.replyingTo.senderName, summary: props.replyingTo.summary })}</span>
              <button type="button" className="onebot-webqq-webqq__reply-draft-close" aria-label={t('webqq.composer.clearReply')} onClick={props.onClearReply}>
                <IconX size={15} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {sendFiles.map((file) => file.kind === 'file' || !file.previewUrl ? (
            <span key={file.id} className="onebot-webqq-webqq__send-file">
              <svg className="onebot-webqq-webqq__send-file-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z"></path>
                <path d="M14 2v5h5"></path>
              </svg>
              <span className="onebot-webqq-webqq__send-file-name">
                <span className="onebot-webqq-webqq__send-file-base">{file.baseName}</span><span>{file.extension}</span>
              </span>
              <button type="button" aria-label={t('webqq.composer.removeFile', { name: file.file.name })} onClick={() => removeSendFile(file.id)}>{removeIcon}</button>
            </span>
          ) : file.kind === 'video' ? (
            <span key={file.id} className="onebot-webqq-webqq__send-image">
              <span className="onebot-webqq-webqq__send-image-preview" role="img" aria-label={t('webqq.composer.video', { name: file.file.name })}>
                <video src={file.previewUrl} muted playsInline preload="metadata" aria-hidden="true"></video>
              </span>
              <button type="button" className="onebot-webqq-webqq__send-image-remove" aria-label={t('webqq.composer.removeFile', { name: file.file.name })} onClick={() => removeSendFile(file.id)}>{removeIcon}</button>
            </span>
          ) : (
            <span key={file.id} className="onebot-webqq-webqq__send-image">
              <button className="onebot-webqq-webqq__send-image-preview" type="button" aria-label={t('webqq.composer.previewFile', { name: file.file.name })} onClick={() => file.previewUrl && props.onPreviewAttachment(file.previewUrl)}>
                <img src={file.previewUrl} alt={file.file.name} />
              </button>
              <button type="button" className="onebot-webqq-webqq__send-image-remove" aria-label={t('webqq.composer.removeFile', { name: file.file.name })} onClick={() => removeSendFile(file.id)}>{removeIcon}</button>
            </span>
          ))}
        </div>
      ) : null}
      {props.botAvatar
        ? <img className="onebot-webqq-webqq__send-avatar" src={props.botAvatar} alt="" />
        : <span className="onebot-webqq-webqq__send-avatar" aria-hidden="true"></span>}
      <div className="onebot-webqq-webqq__send-main">
        {draftEmpty ? <span className="onebot-webqq-webqq__send-placeholder" aria-hidden="true">{t('webqq.composer.placeholder')}</span> : null}
        <div
          ref={setEditor}
          className="onebot-webqq-webqq__send-text"
          role="textbox"
          aria-multiline="true"
          aria-disabled={props.sending ? 'true' : undefined}
          contentEditable={props.sending ? 'false' : 'true'}
          suppressContentEditableWarning
          onKeyDown={handleKeyDown}
          onInput={handleComposerInput}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
            handleComposerInput()
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? [])
            if (!files.length) return
            event.preventDefault()
            addSendFiles(files)
          }}
          onMouseUp={() => syncComposerCaretFromDom()}
          onKeyUp={() => syncComposerCaretFromDom()}
        ></div>
        {mentionMenuOpen ? (
          <MentionMenu candidates={filteredMentionCandidates} activeIndex={mentionMenuIndex} onSelect={selectMentionCandidate} onHover={setMentionMenuIndex} />
        ) : null}
      </div>
      <input
        ref={fileInput}
        className="onebot-webqq-webqq__send-file-input"
        type="file"
        multiple
        onChange={(event) => {
          const input = event.currentTarget
          if (input.files) addSendFiles(input.files)
          input.value = ''
        }}
      />
      <button className="onebot-webqq-webqq__send-action" type="button" aria-label={t('webqq.composer.chooseFile')} disabled={props.sending} onClick={() => fileInput.current?.click()}>
        <svg className="onebot-webqq-webqq__send-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.5 12.5 21a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5"></path></svg>
      </button>
      <button className="onebot-webqq-webqq__send-action is-primary" type="submit" aria-label={t('webqq.composer.send')} disabled={props.sending || !canSend}>
        <svg className="onebot-webqq-webqq__send-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13"></path><path d="m22 2-7 20-4-9-9-4Z"></path></svg>
      </button>
    </form>
  )
}
