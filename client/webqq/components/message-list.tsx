import * as React from 'react'
import {
  IconArrowBackUp,
  IconAt,
  IconCheck,
  IconChecks,
  IconHandClick,
  IconId,
  IconMessageReply,
  IconMoodSmile,
  IconTag,
  IconUserMinus,
  IconUsers,
} from '@tabler/icons-react'
import type { MirroredConfigValues } from '../../../src/config/spec'
import { useT } from '../../i18n'
import { CssTransition } from '../../shared/transition'
import type { WebQQController, WebQQState } from '../controller'
import { requestWebQQRecordTranscription } from '../api/webqq'
import type { WebQQGroupMember, WebQQMessage } from '../types'
import { getFriendMenuActions } from '../utils/friend-menu'
import { rememberFloatingPanelAnchor } from '../utils/floating-panel'
import { getGroupMemberInteractionActions, hasGroupMemberManagementMenu } from '../utils/group-menu'
import {
  formatSenderLevel,
  formatThinkingDuration,
  formatTime,
  getForwardItemName,
  getForwardPreviewItems,
  getForwardPreviewText,
  getLastOutgoingClusterThinkingMessage,
  getLastOutgoingClusterUsageMessage,
  getMessageClusterClass,
  getSenderAuthorityClass,
  getSenderAuthorityText,
  getWebQQElementRuns,
  isImageOnlyMessage,
  isInlineWebQQElement,
  isMergedMessage,
  type WebQQMessageElement,
} from '../utils/webqq-message-view'
import { fitWebQQBubbleToInlineLines } from '../utils/webqq-bubble-width'
import { canReactToWebQQMessage, canRecallWebQQMessage } from '../utils/webqq-message-permissions'
import {
  WebQQContextMenu,
  WebQQContextMenuContent,
  WebQQContextMenuItem,
  WebQQContextMenuSub,
  WebQQContextMenuSubTrigger,
  WebQQContextMenuTrigger,
} from '../ui'
import { WebQQGroupMemberMenu, WebQQMessageReactions } from './shared'

type WebQQUsage = NonNullable<WebQQMessage['usage']>

const FORWARD_PREVIEW_LIMIT = 4

function getMessageDomKey(message: WebQQMessage) {
  return message.id || message.sequence
}

function getRecordKey(message: WebQQMessage, element: WebQQMessageElement, runIndex: number) {
  return `${getMessageDomKey(message)}:${runIndex}:${element.url || element.duration || element.text || ''}`
}

function formatThinkingMetricDuration(value: number | undefined) {
  if (value == null) return ''
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function formatThinkingTps(value: number | undefined) {
  if (value == null) return ''
  return `${value.toFixed(value < 10 ? 1 : 0)}/s`
}

function formatRecordDuration(duration: number) {
  const totalSeconds = Math.max(0, Math.round(duration))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return minutes > 0 ? `${minutes}:${seconds}` : `${totalSeconds}"`
}

function getRecordPlayerStyle(element: WebQQMessageElement) {
  const duration = Math.max(0, Math.round(element.duration || 0))
  return { width: `${Math.min(220, Math.max(128, 128 + duration * 3))}px` }
}

function hasUsageTiming(usage: WebQQUsage | undefined) {
  return usage?.ttftMs != null || usage?.totalMs != null || usage?.tps != null
}

function UsageMetrics(props: { usage: WebQQUsage, showTokens: boolean, showTiming: boolean }) {
  const { usage } = props
  return (
    <>
      {props.showTokens ? (
        <span className="onebot-webqq-webqq__thinking-usage-group">
          <svg className="onebot-webqq-webqq__thinking-usage-icon is-input" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 20V8"></path>
            <path d="m7 13 5-5 5 5"></path>
            <path d="M5 4h14"></path>
          </svg>
          <span>{usage.inputTokens}</span>
          <svg className="onebot-webqq-webqq__thinking-usage-icon is-output" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4v12"></path>
            <path d="m7 11 5 5 5-5"></path>
            <path d="M5 20h14"></path>
          </svg>
          <span>{usage.outputTokens}</span>
        </span>
      ) : null}
      {props.showTiming ? (
        <span className="onebot-webqq-webqq__thinking-usage-group is-timing">
          {usage.ttftMs != null ? <span className="onebot-webqq-webqq__thinking-metric">TTFT {formatThinkingMetricDuration(usage.ttftMs)}</span> : null}
          {usage.tps != null ? <span className="onebot-webqq-webqq__thinking-metric">TPS {formatThinkingTps(usage.tps)}</span> : null}
          {usage.totalMs != null ? <span className="onebot-webqq-webqq__thinking-metric">Total {formatThinkingMetricDuration(usage.totalMs)}</span> : null}
        </span>
      ) : null}
    </>
  )
}

interface RecordPlayback {
  playingKey: string
  loadingKey: string
  transcripts: Record<string, string>
  transcribing: Record<string, boolean>
  registerAudio: (key: string, audio: HTMLAudioElement | null) => void
  toggle: (key: string) => void
  setPlaying: (key: string, playing: boolean) => void
  transcribe: (key: string, messageId: string) => void
}

/**
 * 消息列表：渲染消息行、等待气泡、思考块与用量。右键菜单按原插件拆成两层：消息气泡上是回复/贴表情/
 * 多选/撤回，头像上是资料与好友、群成员操作；头像菜单不冒泡到消息菜单。
 */
export function WebQQMessageList(props: { c: WebQQController, s: WebQQState, settings: MirroredConfigValues }) {
  const { c, s, settings } = props
  const t = useT()
  const messages = c.visibleMessages()
  const chatType = s.currentChat?.type || ''
  const operatorId = c.currentOperatorId
  const groupMembers = s.groupInfo.members
  const chatStyle = settings.webQQChatStyle

  const messageElements = React.useRef(new Map<string, HTMLElement>())
  const bubbleElements = React.useRef(new Map<string, HTMLElement>())
  const audioElements = React.useRef(new Map<string, HTMLAudioElement>())
  const [highlightedKey, setHighlightedKey] = React.useState('')
  const highlightTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  const [playingKey, setPlayingKey] = React.useState('')
  const [loadingKey, setLoadingKey] = React.useState('')
  const [transcripts, setTranscripts] = React.useState<Record<string, string>>({})
  const [transcribing, setTranscribing] = React.useState<Record<string, boolean>>({})
  const textBubbleObserver = React.useRef<ResizeObserver>(undefined)
  const fitFrame = React.useRef<number>(undefined)
  const pendingRowRects = React.useRef<Map<string, DOMRect>>(undefined)
  const playingKeyRef = React.useRef(playingKey)
  playingKeyRef.current = playingKey

  const scrollToQuotedMessage = React.useCallback((targetMessageId: string) => {
    const target = c.visibleMessages().find((message) => message.id === targetMessageId || message.sequence === targetMessageId)
    if (!target) return false
    const key = getMessageDomKey(target)
    const element = messageElements.current.get(key)
    if (!element) return false
    clearTimeout(highlightTimer.current)
    setHighlightedKey(key)
    element.scrollIntoView({ block: 'center', behavior: 'smooth' })
    highlightTimer.current = setTimeout(() => setHighlightedKey((current) => current === key ? '' : current), 1400)
    return true
  }, [c])

  React.useEffect(() => {
    c.scrollToMessage = scrollToQuotedMessage
    const audios = audioElements.current
    return () => {
      c.scrollToMessage = () => false
      clearTimeout(highlightTimer.current)
      if (fitFrame.current != null) cancelAnimationFrame(fitFrame.current)
      textBubbleObserver.current?.disconnect()
      for (const audio of audios.values()) audio.pause()
    }
  }, [c, scrollToQuotedMessage])

  // 纯文本气泡在浏览器按可用宽度换行后不会再按「最长实际行」回缩；渲染后读行矩形消除短末行造成的大空白。
  const scheduleFitTextBubbles = React.useCallback(() => {
    if (fitFrame.current != null) return
    fitFrame.current = requestAnimationFrame(() => {
      fitFrame.current = undefined
      for (const bubble of bubbleElements.current.values()) fitWebQQBubbleToInlineLines(bubble)
    })
  }, [])

  const registerBubble = React.useCallback((message: WebQQMessage, element: HTMLElement | null) => {
    const key = getMessageDomKey(message)
    if (!key) return
    if (!element) {
      bubbleElements.current.delete(key)
      return
    }
    if (!(message.elements.length > 0 && message.elements.every(isInlineWebQQElement))) {
      bubbleElements.current.delete(key)
      element.style.width = ''
      return
    }
    bubbleElements.current.set(key, element)
    if (typeof ResizeObserver !== 'undefined') {
      textBubbleObserver.current ||= new ResizeObserver(scheduleFitTextBubbles)
      const target = element.closest<HTMLElement>('.onebot-webqq-webqq__message') || element.parentElement
      if (target) textBubbleObserver.current.observe(target)
    }
    requestAnimationFrame(() => fitWebQQBubbleToInlineLines(element))
  }, [scheduleFitTextBubbles])

  const registerMessage = React.useCallback((message: WebQQMessage, element: HTMLElement | null) => {
    const key = getMessageDomKey(message)
    if (!key) return
    if (element) messageElements.current.set(key, element)
    else messageElements.current.delete(key)
  }, [])

  // 展开或收起思考块会一次性改变文档流高度；先把受影响的消息钉回旧位置再放开，位移和回弹才不会合成同一帧。
  React.useLayoutEffect(() => {
    const previous = pendingRowRects.current
    if (!previous) return
    pendingRowRects.current = undefined
    const moved: HTMLElement[] = []
    for (const [key, element] of messageElements.current) {
      const rect = previous.get(key)
      if (!rect) continue
      const deltaY = rect.top - element.getBoundingClientRect().top
      if (Math.abs(deltaY) < 0.5) continue
      element.style.transition = 'none'
      element.style.transform = `translateY(${deltaY}px)`
      element.style.willChange = 'transform'
      moved.push(element)
    }
    if (!moved.length) return
    void moved[0]!.getBoundingClientRect()
    const frame = requestAnimationFrame(() => {
      for (const element of moved) {
        element.style.transition = 'transform 0.16s ease'
        element.style.transform = ''
      }
      setTimeout(() => {
        for (const element of moved) {
          element.style.transition = ''
          element.style.transform = ''
          element.style.willChange = ''
        }
      }, 200)
    })
    return () => cancelAnimationFrame(frame)
  })

  const toggleThinking = (message: WebQQMessage) => {
    const rects = new Map<string, DOMRect>()
    for (const [key, element] of messageElements.current) rects.set(key, element.getBoundingClientRect())
    pendingRowRects.current = rects
    c.toggleThinking(message)
  }

  const playback: RecordPlayback = {
    playingKey,
    loadingKey,
    transcripts,
    transcribing,
    registerAudio: (key, audio) => {
      if (audio) audioElements.current.set(key, audio)
      else audioElements.current.delete(key)
    },
    setPlaying: (key, playing) => {
      if (playing) setPlayingKey(key)
      else setPlayingKey((current) => current === key ? '' : current)
    },
    toggle: (key) => {
      const audio = audioElements.current.get(key)
      if (!audio || loadingKey === key) return
      if (playingKeyRef.current === key) {
        audio.pause()
        setPlayingKey('')
        return
      }
      if (playingKeyRef.current) audioElements.current.get(playingKeyRef.current)?.pause()
      setLoadingKey(key)
      audio.play()
        .then(() => setPlayingKey(key))
        .catch(() => setPlayingKey((current) => current === key ? '' : current))
        .finally(() => setLoadingKey((current) => current === key ? '' : current))
    },
    transcribe: (key, messageId) => {
      if (transcribing[key]) return
      setTranscribing((current) => ({ ...current, [key]: true }))
      requestWebQQRecordTranscription(messageId)
        .then((text) => setTranscripts((current) => ({ ...current, [key]: text || t('webqq.record.unrecognized') })))
        .catch(() => setTranscripts((current) => ({ ...current, [key]: t('webqq.record.failed') })))
        .finally(() => setTranscribing((current) => {
          const next = { ...current }
          delete next[key]
          return next
        }))
    },
  }

  if (s.loading) return <div className="onebot-webqq-webqq__placeholder">{t('webqq.common.loading')}</div>
  if (s.errorText) return <div className="onebot-webqq-webqq__placeholder is-error">{s.errorText}</div>
  if (!s.currentChat) return <div className="onebot-webqq-webqq__placeholder">{t('webqq.chat.selectConversation')}</div>
  if (!messages.length) return <div className="onebot-webqq-webqq__placeholder">{t('webqq.chat.empty')}</div>

  const getGroupMember = (userId: string | undefined) => userId ? groupMembers.find((member) => member.userId === userId) : undefined
  const friendStates = new Set(s.contacts.friends.map((friend) => friend.userId))

  return (
    <>
      {c.canLoadOlderMessages() ? (
        <div className="onebot-webqq-webqq__history-more-row">
          <button type="button" className="onebot-webqq-webqq__history-more" disabled={s.historyLoading} onClick={() => void c.loadOlderMessages()}>
            {s.historyLoading ? t('webqq.chat.loadingMore') : t('webqq.chat.loadMore')}
          </button>
        </div>
      ) : null}
      {messages.map((message, index) => {
        const key = getMessageDomKey(message)
        if (message.event) return <div key={key} className="onebot-webqq-webqq__message-event">{message.summary}</div>
        const thinkingMessage = getLastOutgoingClusterThinkingMessage(messages, index)
        const usageMessage = thinkingMessage ? undefined : getLastOutgoingClusterUsageMessage(messages, index)
        const thinkingUsage = thinkingMessage?.thinking.usage
        const thinkingTokens = settings.showWebQQThinkingTokens && !!thinkingUsage
        const thinkingTiming = settings.showWebQQThinkingTiming && hasUsageTiming(thinkingUsage)
        const fallbackUsage = usageMessage?.usage
        const fallbackTokens = settings.showWebQQThinkingTokens && !!fallbackUsage
        const fallbackTiming = settings.showWebQQThinkingTiming && hasUsageTiming(fallbackUsage)
        const expanded = thinkingMessage ? c.isThinkingExpanded(thinkingMessage) : false
        return (
          <React.Fragment key={key}>
            <MessageRow
              c={c}
              message={message}
              clusterClass={getMessageClusterClass(c.getState().messages, index, chatStyle)}
              merged={isMergedMessage(c.getState().messages, index, chatStyle)}
              thinking={c.isBotThinkingMessage(message)}
              highlighted={!!highlightedKey && highlightedKey === key}
              selectionMode={s.selectionMode}
              selected={s.selectedMessageIds.includes(message.id)}
              chatType={chatType}
              operatorId={operatorId}
              groupMembers={groupMembers}
              isFriend={friendStates.has(message.senderId)}
              actor={getGroupMember(operatorId)}
              member={getGroupMember(message.senderId)}
              settings={settings}
              playback={playback}
              registerMessage={registerMessage}
              registerBubble={registerBubble}
              onQuote={scrollToQuotedMessage}
            />
            {thinkingMessage ? (
              <div className="onebot-webqq-webqq__thinking-row">
                <button className="onebot-webqq-webqq__thinking-toggle" type="button" aria-expanded={expanded} onClick={() => toggleThinking(thinkingMessage)}>
                  {thinkingTokens || thinkingTiming ? (
                    <span className="onebot-webqq-webqq__thinking-usage" aria-label={t('webqq.thinking.usageLabel')}>
                      <UsageMetrics usage={thinkingUsage!} showTokens={thinkingTokens} showTiming={thinkingTiming} />
                    </span>
                  ) : null}
                  <span>{formatThinkingDuration(thinkingMessage.thinking.durationMs)}</span>
                  <svg className={['onebot-webqq-webqq__thinking-chevron', expanded ? 'is-expanded' : ''].filter(Boolean).join(' ')} viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M6 3.5 10.5 8 6 12.5"></path>
                  </svg>
                </button>
                <CssTransition name="onebot-webqq-webqq-thinking" show={expanded} onBeforeLeave={prepareThinkingPanelLeave}>
                  <div className="onebot-webqq-webqq__thinking-panel">
                    <div className="onebot-webqq-webqq__thinking-content">{thinkingMessage.thinking.content}</div>
                  </div>
                </CssTransition>
              </div>
            ) : fallbackTokens || fallbackTiming ? (
              <div className="onebot-webqq-webqq__thinking-row is-usage-only">
                <div className="onebot-webqq-webqq__thinking-usage" aria-label={t('webqq.thinking.usageLabel')}>
                  <UsageMetrics usage={fallbackUsage!} showTokens={fallbackTokens} showTiming={fallbackTiming} />
                </div>
              </div>
            ) : null}
          </React.Fragment>
        )
      })}
    </>
  )
}

/** 离场面板冻结在原视觉位置并脱离文档流，后续消息的上移才能和面板淡出同时开始。 */
function prepareThinkingPanelLeave(element: HTMLElement) {
  if (!element.parentElement) return
  const parentRect = element.parentElement.getBoundingClientRect()
  const panelRect = element.getBoundingClientRect()
  element.style.position = 'absolute'
  element.style.top = `${panelRect.top - parentRect.top}px`
  element.style.right = `${parentRect.right - panelRect.right}px`
  element.style.width = `${panelRect.width}px`
  element.style.marginTop = '0'
}

function MessageRow(props: {
  c: WebQQController
  message: WebQQMessage
  clusterClass: string
  merged: boolean
  thinking: boolean
  highlighted: boolean
  selectionMode: boolean
  selected: boolean
  chatType: 'friend' | 'group' | ''
  operatorId: string
  groupMembers: WebQQGroupMember[]
  isFriend: boolean
  actor?: WebQQGroupMember
  member?: WebQQGroupMember
  settings: MirroredConfigValues
  playback: RecordPlayback
  registerMessage: (message: WebQQMessage, element: HTMLElement | null) => void
  registerBubble: (message: WebQQMessage, element: HTMLElement | null) => void
  onQuote: (messageId: string) => boolean
}) {
  const { c, message, settings, chatType, operatorId, selectionMode } = props
  const t = useT()
  const chatStyle = settings.webQQChatStyle
  const selectable = !message.event && !message.recalled && !!message.id
  const canReact = canReactToWebQQMessage(message, chatType, operatorId)
  const canRecall = canRecallWebQQMessage(message, chatType, operatorId, props.groupMembers)
  const friendActions = getFriendMenuActions({ isFriend: props.isFriend, pendingOutgoing: false, pendingIncoming: false }, true)
  const memberActions = props.member ? getGroupMemberInteractionActions(props.actor, props.member) : []
  const hasManagement = props.member ? hasGroupMemberManagementMenu(props.actor, props.member) : false
  const imageOnly = isImageOnlyMessage(message)
  const imageOnlyUrl = message.elements[0]?.type === 'image' ? message.elements[0].url || '' : ''
  const icon = (Icon: typeof IconId) => <Icon size={16} aria-hidden="true" />

  const toggleReaction = (emojiId: string) => {
    if (!canReact || !message.id || !operatorId) return
    const reaction = message.reactions?.find((item) => item.emojiId === emojiId)
    const mine = reaction?.users?.some((user) => user.userId === operatorId) || reaction?.userId === operatorId
    c.handleSetMessageReaction(message.id, emojiId, !mine)
  }

  const handleBubbleClickCapture = (event: React.MouseEvent) => {
    if (!selectionMode || !selectable) return
    event.preventDefault()
    event.stopPropagation()
    c.toggleSelection(message.id)
  }

  const handleRowClick = (event: React.MouseEvent) => {
    if (!selectionMode || !selectable) return
    // 气泡由捕获处理器统一接管；这里只覆盖头像、发送者信息和行内空白区域。
    if (event.target instanceof Element && event.target.closest('.onebot-webqq-webqq__bubble, .onebot-webqq-webqq__message-media-stack')) return
    c.toggleSelection(message.id)
  }

  const reactions = message.reactions?.length
    ? <WebQQMessageReactions reactions={message.reactions} chatStyle={chatStyle} readonly={!canReact} onToggle={toggleReaction} />
    : null

  const affinity = message.senderId !== operatorId && message.senderAffinity != null && settings.showWebQQAffinity
    ? (
        <span className="onebot-webqq-webqq__message-affinity">
          <svg className="onebot-webqq-webqq__message-affinity-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>
          </svg>
          {message.senderAffinity < 0
            ? <span><span className="onebot-webqq-webqq__message-affinity-sign">-</span>{-message.senderAffinity}</span>
            : <span>{message.senderAffinity}</span>}
        </span>
      )
    : null

  const authorityText = getSenderAuthorityText(message)
  const authority = authorityText ? <span className={['onebot-webqq-webqq__sender-badge', getSenderAuthorityClass(message)].join(' ')}>{authorityText}</span> : null
  const level = message.senderLevel && !settings.hideWebQQGroupLevel
    ? <span className="onebot-webqq-webqq__sender-badge is-level">{formatSenderLevel(message.senderLevel)}</span>
    : null
  const name = <span className="onebot-webqq-webqq__message-name">{message.senderName}</span>

  const avatarMenu = (
    <span className="onebot-webqq-webqq__message-avatar-context" onContextMenuCapture={(event) => rememberFloatingPanelAnchor(event.nativeEvent)}>
      <WebQQContextMenu disabled={selectionMode}>
        <WebQQContextMenuTrigger
          render={(
            <button
              type="button"
              className="onebot-webqq-webqq__message-avatar-trigger"
              aria-label={t('webqq.chat.viewProfileOf', { name: message.senderName })}
              onClick={(event) => {
                // 多选时头像仍属于整条消息的可选区域；不能阻断冒泡，否则点击头像无法切换勾选。
                if (selectionMode) return
                event.preventDefault()
                event.stopPropagation()
                void c.openUserProfile(message.senderId, event.nativeEvent)
              }}
              onContextMenu={(event) => {
                // 头像右键菜单不能冒泡到消息行，否则会打开消息菜单。
                rememberFloatingPanelAnchor(event.nativeEvent)
                event.stopPropagation()
              }}
              onPointerDown={(event) => {
                if (event.button === 2) rememberFloatingPanelAnchor(event.nativeEvent)
              }}
            />
          )}
        >
          <span className="onebot-webqq-webqq__message-avatar-wrap">
            {message.senderAvatar
              ? <img className="onebot-webqq-webqq__message-avatar" src={message.senderAvatar} alt={message.senderName} />
              : <span className="onebot-webqq-webqq__message-avatar is-fallback" aria-hidden="true">{message.senderName.slice(0, 1)}</span>}
            {affinity}
          </span>
        </WebQQContextMenuTrigger>
        <WebQQContextMenuContent>
          <WebQQContextMenuItem onClick={() => void c.openUserProfile(message.senderId)}>{icon(IconId)} {t('webqq.menu.viewProfile')}</WebQQContextMenuItem>
          {chatType === 'group' && memberActions.includes('mention')
            ? <WebQQContextMenuItem onClick={() => c.handleMentionGroupMember(message.senderId)}>{icon(IconAt)} {t('webqq.member.mention')}</WebQQContextMenuItem>
            : null}
          {chatType === 'group' && memberActions.includes('poke')
            ? <WebQQContextMenuItem onClick={() => c.handlePokeGroupMember(message.senderId)}>{icon(IconHandClick)} {t('webqq.member.poke')}</WebQQContextMenuItem>
            : null}
          {chatType === 'group' && hasManagement && props.member ? (
            <WebQQContextMenuSub>
              <WebQQContextMenuSubTrigger>{icon(IconUsers)} {t('webqq.member.manage')}</WebQQContextMenuSubTrigger>
              <WebQQGroupMemberMenu
                sub
                actor={props.actor}
                member={props.member}
                onSetCard={() => c.openGroupCardDialog(message.senderId)}
                onSetTitle={() => c.openGroupTitleDialog(message.senderId)}
                onSetAdmin={(enabled) => c.handleSetGroupAdmin(message.senderId, enabled)}
                onKick={() => c.handleKickGroupMember(message.senderId)}
              />
            </WebQQContextMenuSub>
          ) : null}
          {message.senderId !== operatorId && chatType !== 'group' ? (
            <>
              {friendActions.includes('poke') ? <WebQQContextMenuItem onClick={() => c.handlePokeFriend(message.senderId)}>{icon(IconHandClick)} {t('webqq.member.poke')}</WebQQContextMenuItem> : null}
              {friendActions.includes('remark') ? <WebQQContextMenuItem onClick={() => c.openRemarkDialog(message.senderId)}>{icon(IconTag)} {t('webqq.menu.setRemark')}</WebQQContextMenuItem> : null}
              {friendActions.includes('delete') ? <WebQQContextMenuItem className="is-danger" onClick={() => c.confirmDeleteFriend(message.senderId)}>{icon(IconUserMinus)} {t('webqq.menu.deleteFriend')}</WebQQContextMenuItem> : null}
            </>
          ) : null}
        </WebQQContextMenuContent>
      </WebQQContextMenu>
    </span>
  )

  const renderElement = (element: WebQQMessageElement, runIndex: number) => {
    if (element.type === 'quote') {
      const content = (
        <>
          {element.title ? <strong className="onebot-webqq-webqq__quote-title">{element.title}</strong> : null}
          <span>{element.text || '[引用消息]'}</span>
        </>
      )
      if (!element.targetMessageId) return <div key={runIndex} className="onebot-webqq-webqq__quote">{content}</div>
      const targetMessageId = element.targetMessageId
      return (
        <button
          key={runIndex}
          className="onebot-webqq-webqq__quote is-clickable"
          type="button"
          aria-label={t('webqq.chat.jumpToQuote')}
          onClick={(event) => {
            event.stopPropagation()
            props.onQuote(targetMessageId)
          }}
        >
          {content}
        </button>
      )
    }
    if (element.type === 'forward') {
      return (
        <button
          key={runIndex}
          className="onebot-webqq-webqq__quote onebot-webqq-webqq__forward"
          type="button"
          disabled={!element.items?.length}
          aria-label={t('webqq.chat.viewForward')}
          onClick={(event) => {
            event.stopPropagation()
            c.openForwardDialog(element)
          }}
        >
          <strong className="onebot-webqq-webqq__quote-title">{element.title || '合并转发'}</strong>
          {element.items?.length ? (
            <>
              {getForwardPreviewItems(element, FORWARD_PREVIEW_LIMIT).map((item, itemIndex) => (
                <span key={itemIndex}>{getForwardItemName(item)}：{getForwardPreviewText(item)}</span>
              ))}
              <span className="onebot-webqq-webqq__forward-entry">{t('webqq.chat.forwardCount', { count: element.items.length })}</span>
            </>
          ) : <span>{element.text || '[合并转发]'}</span>}
        </button>
      )
    }
    if (element.type === 'card') {
      return (
        <div key={runIndex} className="onebot-webqq-webqq__card">
          {element.imageUrl ? <img className="onebot-webqq-webqq__card-cover" src={element.imageUrl} alt="" /> : null}
          <span className="onebot-webqq-webqq__card-content">
            <strong className="onebot-webqq-webqq__card-title">{element.title || '卡片消息'}</strong>
            {element.text ? <span className="onebot-webqq-webqq__card-desc">{element.text}</span> : null}
            {element.source ? <span className="onebot-webqq-webqq__card-source">{element.source}</span> : null}
          </span>
        </div>
      )
    }
    if (element.type === 'image' && element.url) {
      const url = element.url
      return (
        <button key={runIndex} className="onebot-webqq-webqq__message-image" type="button" aria-label={t('webqq.chat.viewImage')} onClick={() => c.openImagePreview(url)}>
          <img src={url} alt={t('webqq.chat.image')} onLoad={c.handleMessageImageLoad} />
        </button>
      )
    }
    if (element.type === 'record') return <RecordElement key={runIndex} message={message} element={element} runIndex={runIndex} playback={props.playback} />
    return <span key={runIndex}>{element.text || message.summary}</span>
  }

  return (
    <WebQQContextMenu disabled={!!message.recalled || selectionMode}>
      <div
        ref={(element) => props.registerMessage(message, element)}
        className={[
          'onebot-webqq-webqq__message',
          `is-${message.direction}`,
          props.clusterClass,
          props.merged ? 'is-merged' : '',
          props.thinking ? 'is-thinking' : '',
          message.recalled ? 'is-recalled' : '',
          props.highlighted ? 'is-quote-target' : '',
          selectionMode ? 'is-selecting' : '',
          selectionMode && selectable ? 'is-selectable' : '',
          selectionMode && props.selected ? 'is-selected' : '',
        ].filter(Boolean).join(' ')}
        aria-selected={selectionMode ? props.selected : undefined}
        onClick={handleRowClick}
      >
        {selectionMode && selectable ? (
          <span className={['onebot-webqq-webqq__message-select-marker', props.selected ? 'is-checked' : ''].filter(Boolean).join(' ')} aria-hidden="true">
            <IconCheck size={12} stroke={3} />
          </span>
        ) : null}
        <div className="onebot-webqq-webqq__message-select-body">
          {avatarMenu}
          <div className="onebot-webqq-webqq__message-content">
            {!props.merged ? (
              <div className="onebot-webqq-webqq__sender-line">
                {message.direction === 'outgoing' ? <>{authority}{level}{name}</> : <>{name}{level}{authority}</>}
              </div>
            ) : null}
            <div className={['onebot-webqq-webqq__message-body', imageOnly ? 'is-image-only' : ''].filter(Boolean).join(' ')}>
              {imageOnly ? (
                <div className="onebot-webqq-webqq__message-media-stack" onClickCapture={handleBubbleClickCapture}>
                  <WebQQContextMenuTrigger
                    render={<div className="onebot-webqq-webqq__message-media" onContextMenu={(event) => rememberFloatingPanelAnchor(event.nativeEvent)} />}
                  >
                    <button className="onebot-webqq-webqq__message-image" type="button" aria-label={t('webqq.chat.viewImage')} onClick={() => imageOnlyUrl && c.openImagePreview(imageOnlyUrl)}>
                      <img src={imageOnlyUrl} alt={t('webqq.chat.image')} onLoad={c.handleMessageImageLoad} />
                    </button>
                  </WebQQContextMenuTrigger>
                  {chatStyle === 'tim' ? reactions : null}
                </div>
              ) : (
                <WebQQContextMenuTrigger
                  render={(
                    <div
                      ref={(element) => props.registerBubble(message, element)}
                      className="onebot-webqq-webqq__bubble"
                      onClickCapture={handleBubbleClickCapture}
                      onContextMenu={(event) => rememberFloatingPanelAnchor(event.nativeEvent)}
                    />
                  )}
                >
                  {props.thinking ? (
                    <span className="onebot-webqq-webqq__thinking-dots" aria-label={t('webqq.chat.botThinking')}>
                      {[1, 2, 3].map((dot) => <span key={dot} className="onebot-webqq-webqq__thinking-dot"></span>)}
                    </span>
                  ) : getWebQQElementRuns(message.elements).map((run, runIndex) => run.type === 'inline' ? (
                    <span key={runIndex} className="onebot-webqq-webqq__inline-run">
                      {run.elements.map((element, elementIndex) => element.type === 'text'
                        ? <span key={elementIndex}>{element.text}</span>
                        : element.type === 'face' && element.emojiUrl
                          ? <img key={elementIndex} className="onebot-webqq-webqq__message-face" src={element.emojiUrl} alt={element.text || t('webqq.chat.face')} onLoad={c.handleMessageImageLoad} />
                          : <span key={elementIndex}>{element.text || message.summary}</span>)}
                    </span>
                  ) : renderElement(run.element, runIndex))}
                  {chatStyle === 'tim' ? reactions : null}
                </WebQQContextMenuTrigger>
              )}
              {chatStyle !== 'tim' ? reactions : null}
              {message.recalled ? <div className="onebot-webqq-webqq__message-recall-status">{t('webqq.chat.recalled')}</div> : null}
              <div className="onebot-webqq-webqq__message-time">{formatTime(message.time)}</div>
            </div>
          </div>
        </div>
      </div>
      <WebQQContextMenuContent>
        {!message.recalled ? <WebQQContextMenuItem onClick={() => c.setReplyTarget(message.id)}>{icon(IconMessageReply)} {t('webqq.message.reply')}</WebQQContextMenuItem> : null}
        {canReact ? <WebQQContextMenuItem onClick={() => c.openReactionPicker(message.id)}>{icon(IconMoodSmile)} {t('webqq.message.react')}</WebQQContextMenuItem> : null}
        {!message.recalled && !message.event ? <WebQQContextMenuItem onClick={() => c.enterSelection(message.id)}>{icon(IconChecks)} {t('webqq.message.select')}</WebQQContextMenuItem> : null}
        {canRecall ? <WebQQContextMenuItem className="is-danger" onClick={() => c.handleRecallMessage(message.id)}>{icon(IconArrowBackUp)} {t('webqq.message.recall')}</WebQQContextMenuItem> : null}
      </WebQQContextMenuContent>
    </WebQQContextMenu>
  )
}

function RecordElement(props: { message: WebQQMessage, element: WebQQMessageElement, runIndex: number, playback: RecordPlayback }) {
  const { message, element, runIndex, playback } = props
  const t = useT()
  const key = getRecordKey(message, element, runIndex)
  const playing = playback.playingKey === key
  const loading = playback.loadingKey === key
  const transcribing = !!playback.transcribing[key]
  const transcript = element.transcript || playback.transcripts[key] || ''
  return (
    <div className="onebot-webqq-webqq__record">
      <div className="onebot-webqq-webqq__record-row">
        {element.url ? (
          <audio
            ref={(audio) => playback.registerAudio(key, audio)}
            className="onebot-webqq-webqq__record-audio"
            src={element.url}
            preload="none"
            onEnded={() => playback.setPlaying(key, false)}
            onPause={() => playback.setPlaying(key, false)}
            onPlay={() => playback.setPlaying(key, true)}
          ></audio>
        ) : null}
        <button
          className={['onebot-webqq-webqq__record-player', playing ? 'is-playing' : '', loading ? 'is-loading' : ''].filter(Boolean).join(' ')}
          type="button"
          disabled={!element.url || loading}
          style={getRecordPlayerStyle(element)}
          aria-label={t('webqq.record.play')}
          onClick={(event) => {
            event.stopPropagation()
            playback.toggle(key)
          }}
        >
          {loading ? (
            <svg className="onebot-webqq-webqq__record-play-icon is-loading" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3a9 9 0 1 1-9 9"></path>
            </svg>
          ) : playing ? (
            <svg className="onebot-webqq-webqq__record-play-icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="7" y="5" width="3.5" height="14" rx="1"></rect>
              <rect x="13.5" y="5" width="3.5" height="14" rx="1"></rect>
            </svg>
          ) : (
            <svg className="onebot-webqq-webqq__record-play-icon is-play" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7Z"></path>
            </svg>
          )}
          <svg className="onebot-webqq-webqq__record-wave" viewBox="0 0 60 18" aria-hidden="true">
            <rect x="1" y="7" width="3" height="4" rx="1.5"></rect>
            <rect x="9" y="4" width="3" height="10" rx="1.5"></rect>
            <rect x="17" y="1" width="3" height="16" rx="1.5"></rect>
            <rect x="25" y="5" width="3" height="8" rx="1.5"></rect>
            <rect x="33" y="4" width="3" height="10" rx="1.5"></rect>
            <rect x="41" y="7" width="3" height="4" rx="1.5"></rect>
            <rect x="49" y="5" width="3" height="8" rx="1.5"></rect>
            <rect x="57" y="7" width="3" height="4" rx="1.5"></rect>
          </svg>
          <span className="onebot-webqq-webqq__record-duration">{formatRecordDuration(element.duration || 0)}</span>
        </button>
        {message.id && !transcript ? (
          <button
            className="onebot-webqq-webqq__record-transcribe"
            type="button"
            disabled={transcribing}
            aria-label={t('webqq.record.transcribe')}
            onClick={(event) => {
              event.stopPropagation()
              playback.transcribe(key, message.id)
            }}
          >
            {transcribing ? (
              <svg className="onebot-webqq-webqq__record-transcribe-icon is-loading" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3a9 9 0 1 1-9 9"></path>
              </svg>
            ) : (
              <svg className="onebot-webqq-webqq__record-transcribe-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 5.5h14a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-7l-4.5 3v-3H5A2.5 2.5 0 0 1 2.5 14V8A2.5 2.5 0 0 1 5 5.5Z"></path>
                <path d="M7.5 9.5h9"></path>
                <path d="M7.5 13h6"></path>
              </svg>
            )}
          </button>
        ) : null}
      </div>
      {transcript ? <div className="onebot-webqq-webqq__record-transcript">{transcript}</div> : null}
    </div>
  )
}
