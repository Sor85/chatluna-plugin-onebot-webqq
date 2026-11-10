import * as React from 'react'
import { IconId, IconSearch, IconShare3 } from '@tabler/icons-react'
import { readStored, writeStored } from '@chatluna/ui-storage'
import { bindStoreTranslator, useT } from '../i18n'
import { useStore } from '../shared/store'
import { CssTransition } from '../shared/transition'
import { capsuleAnchor as capsuleAnchorStore, config as configStore } from '../runtime'
import { WebQQController } from './controller'
import { rememberFloatingPanelAnchor } from './utils/floating-panel'
import { getCurrentChatAvatar, getCurrentChatSubtitle, getCurrentChatTitle } from './utils/webqq-contact-view'
import { useWebQQFrostedSurfaceFlag } from './utils/webqq-frosted-surface'
import { resolveWebQQPanelAnchor } from './utils/webqq-panel-anchor'
import { useWebQQScrollbar } from './utils/webqq-scrollbar'
import { getWebQQAccentStyle } from './utils/webqq-theme-view'
import { WebQQButton, useResolvedColorMode, WebQQContextMenu, WebQQContextMenuContent, WebQQContextMenuItem, WebQQContextMenuTrigger } from './ui'
import { WebQQSidebar, WebQQNoticeMenu } from './components/sidebar'
import { WebQQMessageList } from './components/message-list'
import { WebQQComposer } from './components/composer'
import { WebQQForwardModal, WebQQGroupInfoPanel, WebQQImagePreview } from './components/panels'
import { WebQQActionDialog, WebQQConfirmDialog, WebQQForwardTargetDialog } from './components/dialogs'
import { WebQQEmojiPicker, WebQQProfileCard } from './components/portal-pages'
import { WebQQMessageSearchPage } from './components/message-search'

type ResizeEdge = 'left' | 'top' | 'top-left'

interface ShellSize {
  width: number
  height: number
}

const RESIZE_STORAGE_KEY = 'chatluna.onebot-webqq.window-size'
const RESIZE_MIN_WIDTH = 640
const RESIZE_MIN_HEIGHT = 420
const RESIZE_VIEWPORT_WIDTH_GAP = 32
const RESIZE_VIEWPORT_HEIGHT_GAP = 6
const RESIZE_DEFAULT_BOTTOM_GAP = 116

function normalizeShellSize(value: unknown): ShellSize | undefined {
  if (!value || typeof value !== 'object') return
  const width = Reflect.get(value, 'width')
  const height = Reflect.get(value, 'height')
  if (typeof width !== 'number' || typeof height !== 'number') return
  if (!Number.isFinite(width) || !Number.isFinite(height)) return
  return { width, height }
}

/**
 * WebQQ 观察窗。常驻挂载、只在打开时显示：关着的时候也要接收实时消息并累计未读数，小胶囊据此显示徽标。
 */
export function WebQQObserver(props: { visible: boolean }) {
  const t = useT()
  bindStoreTranslator(t)
  const controller = React.useMemo(() => new WebQQController(), [])
  const s = React.useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  const settings = useStore(configStore)
  const capsuleAnchor = useStore(capsuleAnchorStore)
  const colorMode = useResolvedColorMode()
  const root = React.useRef<HTMLDivElement>(null)
  const searchTrigger = React.useRef<HTMLButtonElement>(null)
  const [panelSize, setPanelSize] = React.useState<ShellSize>()
  const [viewport, setViewport] = React.useState<ShellSize>()
  const [shellSize, setShellSize] = React.useState<ShellSize>()
  const [resizing, setResizing] = React.useState(false)
  const resizeState = React.useRef<{ edge: ResizeEdge, startX: number, startY: number, startWidth: number, startHeight: number }>(undefined)
  const messagesScrollbar = useWebQQScrollbar<HTMLDivElement>()
  const messagePaneRef = React.useCallback((element: HTMLDivElement | null) => {
    controller.messagePane = element
    messagesScrollbar(element)
  }, [controller, messagesScrollbar])
  const stopResize = React.useRef<() => void>(() => {})
  React.useEffect(() => () => stopResize.current(), [])

  useWebQQFrostedSurfaceFlag(settings.enableWebQQFrostedGlass)

  // 每次提交后放行等待渲染的异步流程（原 Vue nextTick）。
  React.useLayoutEffect(() => controller.flushAfterRender())

  React.useEffect(() => {
    void controller.mount()
    return () => controller.dispose()
  }, [controller])

  React.useEffect(() => {
    // 查找框由条件渲染卸载；外部 pointerdown 关闭时还会继续派发 mouseup/click，必须等整条指针事件链结束后
    // 再恢复焦点，否则 Chrome 与 Firefox 最终仍会把焦点落到 body。
    controller.restoreSearchTriggerFocus = () => {
      requestAnimationFrame(() => window.setTimeout(() => {
        if (!controller.visible || !searchTrigger.current?.isConnected) return
        searchTrigger.current.focus({ preventScroll: true })
      }, 50))
    }
  }, [controller])

  React.useEffect(() => {
    controller.setVisible(props.visible)
    // 隐藏期间量不到尺寸，显示的那一帧要立刻补量，否则跟随落位会晚一帧。
    if (props.visible) requestAnimationFrame(measurePanel)
  }, [controller, props.visible])

  // Escape 依次退掉：查找 → 转发目标 → 多选 → 回复目标。门户页与弹窗在 document 上先拦住属于它们的那一下。
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!controller.visible || event.key !== 'Escape') return
      if (controller.handleEscape()) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [controller])

  const measurePanel = React.useCallback(() => {
    const rect = root.current?.getBoundingClientRect()
    setPanelSize(rect?.width && rect.height ? { width: rect.width, height: rect.height } : undefined)
  }, [])

  const getResizeBounds = React.useCallback(() => {
    const maxWidth = Math.max(0, window.innerWidth - RESIZE_VIEWPORT_WIDTH_GAP)
    const bottomGap = root.current ? Math.max(0, window.innerHeight - root.current.getBoundingClientRect().bottom) : RESIZE_DEFAULT_BOTTOM_GAP
    const maxHeight = Math.max(0, window.innerHeight - bottomGap - RESIZE_VIEWPORT_HEIGHT_GAP)
    return {
      minWidth: Math.min(RESIZE_MIN_WIDTH, maxWidth),
      minHeight: Math.min(RESIZE_MIN_HEIGHT, maxHeight),
      maxWidth,
      maxHeight,
    }
  }, [])

  const clampShellSize = React.useCallback((size: ShellSize): ShellSize => {
    const bounds = getResizeBounds()
    return {
      width: Math.round(Math.min(Math.max(size.width, bounds.minWidth), bounds.maxWidth)),
      height: Math.round(Math.min(Math.max(size.height, bounds.minHeight), bounds.maxHeight)),
    }
  }, [getResizeBounds])

  React.useEffect(() => {
    const measureViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    const clampCurrent = () => setShellSize((current) => {
      if (!configStore.get().allowWebQQResize || !current) return current
      const next = clampShellSize(current)
      if (next.width === current.width && next.height === current.height) return current
      writeStored(RESIZE_STORAGE_KEY, next)
      return next
    })
    measureViewport()
    measurePanel()
    window.addEventListener('resize', measureViewport)
    window.addEventListener('resize', clampCurrent)
    const observer = typeof ResizeObserver !== 'undefined' && root.current ? new ResizeObserver(measurePanel) : undefined
    if (root.current) observer?.observe(root.current)
    return () => {
      window.removeEventListener('resize', measureViewport)
      window.removeEventListener('resize', clampCurrent)
      observer?.disconnect()
    }
  }, [measurePanel, clampShellSize])

  React.useEffect(() => {
    if (!settings.allowWebQQResize) {
      stopResize.current()
      return
    }
    const stored = normalizeShellSize(readStored(RESIZE_STORAGE_KEY))
    if (stored) setShellSize(clampShellSize(stored))
  }, [settings.allowWebQQResize, clampShellSize])

  const startResize = (edge: ResizeEdge, event: React.PointerEvent) => {
    event.stopPropagation()
    event.preventDefault()
    if (!settings.allowWebQQResize || event.button !== 0 || !root.current) return
    stopResize.current()
    const rect = root.current.getBoundingClientRect()
    resizeState.current = { edge, startX: event.clientX, startY: event.clientY, startWidth: rect.width, startHeight: rect.height }
    setShellSize(clampShellSize({ width: rect.width, height: rect.height }))
    setResizing(true)
    let latest: ShellSize | undefined
    const move = (moveEvent: PointerEvent) => {
      const state = resizeState.current
      if (!state) return
      moveEvent.preventDefault()
      latest = clampShellSize({
        width: state.edge === 'top' ? state.startWidth : state.startWidth + state.startX - moveEvent.clientX,
        height: state.edge === 'left' ? state.startHeight : state.startHeight + state.startY - moveEvent.clientY,
      })
      setShellSize(latest)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      resizeState.current = undefined
      setResizing(false)
      if (latest) writeStored(RESIZE_STORAGE_KEY, latest)
    }
    stopResize.current = stop
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  // 小胶囊被拖走后观察窗跟着走。没拖动过时不接管落位：默认锚点与窄屏媒体查询都在样式表里。
  const followAnchorStyle = capsuleAnchor && panelSize && viewport
    ? (() => {
        const anchor = resolveWebQQPanelAnchor({ entry: capsuleAnchor, panel: panelSize, viewport })
        return { right: `${anchor.right}px`, bottom: `${anchor.bottom}px` }
      })()
    : {}
  const rootStyle = {
    ...getWebQQAccentStyle(settings.webQQAccentColor),
    // 多选模式下输入区整块不渲染，占位取固定值；其余时候用输入区自己观测出来的数字。
    '--onebot-webqq-webqq-send-space': `${s.selectionMode ? 64 : s.webQQSendSpace}px`,
    ...followAnchorStyle,
    ...(settings.allowWebQQResize && shellSize ? { width: `${shellSize.width}px`, height: `${shellSize.height}px` } : {}),
    ...(props.visible ? {} : { display: 'none' }),
  } as React.CSSProperties

  const currentChat = s.currentChat
  const currentTitle = getCurrentChatTitle(currentChat)
  const currentSubtitle = getCurrentChatSubtitle(currentChat, s.contacts)
  const currentAvatar = getCurrentChatAvatar(currentChat)
  const replyingTo = controller.replyingToMessage()
  const mentionCandidates = React.useMemo(() => controller.mentionCandidates(), [s.currentChat, s.groupInfo])
  const forwardTargets = React.useMemo(() => controller.forwardTargets(), [s.contacts, s.conversationSummaries, s.hiddenRecentKeys, t])
  const visibleMessages = controller.visibleMessages()

  return (
    <div
      ref={root}
      className={[
        'onebot-webqq-webqq',
        settings.enableWebQQFrostedGlass ? 'is-frosted' : 'is-plain',
        `is-chat-style-${settings.webQQChatStyle}`,
        settings.webQQTimBubbleTail ? 'has-tim-bubble-tail' : '',
        settings.allowWebQQResize ? 'is-resizable' : '',
        resizing ? 'is-resizing' : '',
        `is-color-${colorMode}`,
      ].filter(Boolean).join(' ')}
      style={rootStyle}
      role="dialog"
      aria-label={t('webqq.window')}
      onClick={controller.closeNoticeMenu}
    >
      <WebQQSidebar c={controller} s={s} />
      <section className={['onebot-webqq-webqq__chat', s.groupInfoOpen && currentChat?.type === 'group' ? 'is-mobile-group-info-open' : ''].filter(Boolean).join(' ')}>
        <div className={['onebot-webqq-webqq__chat-content', s.noticeOpen ? 'is-mobile-notice-open' : ''].filter(Boolean).join(' ')}>
          {s.noticeOpen ? (
            <div className="onebot-webqq-webqq__mobile-notice-page" onClick={(event) => event.stopPropagation()}>
              <WebQQNoticeMenu c={controller} s={s} className="onebot-webqq-webqq__mobile-notice-content" />
            </div>
          ) : null}
          <div className="onebot-webqq-webqq__chat-main">
            <header className={['onebot-webqq-webqq__chat-header', s.messageSearchOpen ? 'is-searching' : ''].filter(Boolean).join(' ')}>
              <div className="onebot-webqq-webqq__chat-title">
                {currentChat ? (
                  <WebQQContextMenu>
                    <WebQQContextMenuTrigger
                      render={(
                        <button
                          type="button"
                          className="onebot-webqq-webqq__chat-avatar-trigger"
                          aria-label={t('webqq.chat.viewProfileOf', { name: currentTitle })}
                          onClick={(event) => void controller.openCurrentChatProfile(event.nativeEvent)}
                          onPointerDown={(event) => {
                            if (event.button === 2) rememberFloatingPanelAnchor(event.nativeEvent)
                          }}
                          onContextMenu={(event) => rememberFloatingPanelAnchor(event.nativeEvent)}
                        />
                      )}
                    >
                      {currentAvatar
                        ? <img className="onebot-webqq-webqq__chat-avatar" src={currentAvatar} alt={currentTitle} />
                        : <span className="onebot-webqq-webqq__chat-avatar is-fallback" aria-hidden="true">{currentTitle.slice(0, 1)}</span>}
                    </WebQQContextMenuTrigger>
                    <WebQQContextMenuContent>
                      <WebQQContextMenuItem onClick={() => void controller.openCurrentChatProfile()}>
                        <IconId size={16} aria-hidden="true" /> {t('webqq.menu.viewProfile')}
                      </WebQQContextMenuItem>
                    </WebQQContextMenuContent>
                  </WebQQContextMenu>
                ) : null}
                <div>
                  <strong>{currentTitle}</strong>
                  <span>{currentSubtitle}</span>
                </div>
              </div>
              <div className="onebot-webqq-webqq__chat-header-actions">
                {currentChat ? (
                  <div className={['onebot-webqq-webqq__chat-search-shell', s.messageSearchOpen ? 'is-expanded' : ''].filter(Boolean).join(' ')}>
                    {s.messageSearchOpen
                      ? <WebQQMessageSearchPage c={controller} s={s} />
                      : (
                          <button ref={searchTrigger} className="onebot-webqq-webqq__chat-search-trigger" type="button" aria-label={t('webqq.search.title')} onClick={controller.openMessageSearch}>
                            <IconSearch className="onebot-webqq-webqq__header-icon" size={20} aria-hidden="true" />
                          </button>
                        )}
                  </div>
                ) : null}
                {currentChat?.type === 'group' ? (
                  <button className={s.groupInfoOpen ? 'is-active' : undefined} type="button" aria-label={s.groupInfoOpen ? t('webqq.group.close') : t('webqq.group.open')} onClick={controller.toggleGroupInfo}>
                    <svg className="onebot-webqq-webqq__header-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="1"></circle>
                      <circle cx="19" cy="12" r="1"></circle>
                      <circle cx="5" cy="12" r="1"></circle>
                    </svg>
                  </button>
                ) : null}
              </div>
            </header>
            <div className={['onebot-webqq-webqq__chat-body', settings.enableWebQQSend && currentChat ? 'has-send-input' : ''].filter(Boolean).join(' ')}>
              <div
                ref={messagePaneRef}
                className={['onebot-webqq-webqq__messages', s.selectionMode ? 'is-selecting' : ''].filter(Boolean).join(' ')}
                onScroll={controller.updateMessageTracking}
              >
                <WebQQMessageList c={controller} s={s} settings={settings} />
              </div>
              {s.selectionMode ? (
                <div className="onebot-webqq-webqq__selection-bar" role="toolbar" aria-label={t('webqq.selection.toolbar')}>
                  <strong className="onebot-webqq-webqq__selection-bar-count">{t('webqq.selection.count', { count: s.selectedMessageIds.length })}</strong>
                  <div className="onebot-webqq-webqq__selection-bar-actions">
                    <WebQQButton variant="outline" className="onebot-webqq-webqq__selection-bar-button" onClick={controller.exitSelection}>{t('webqq.common.cancel')}</WebQQButton>
                    <WebQQButton className="onebot-webqq-webqq__selection-bar-button" disabled={!s.selectedMessageIds.length} onClick={controller.handleSelectionForward}>
                      <IconShare3 size={16} aria-hidden="true" />
                      {t('webqq.forwardTarget.submit')}
                    </WebQQButton>
                  </div>
                </div>
              ) : null}
              {settings.enableWebQQSend && currentChat && !s.selectionMode ? (
                <WebQQComposer
                  visible={props.visible}
                  sending={s.sendingWebQQMessage}
                  mentionCandidates={mentionCandidates}
                  chatKey={`${currentChat.type}:${currentChat.peerId}`}
                  botAvatar={controller.selectedBotAvatar()}
                  replyingTo={replyingTo ? { senderName: replyingTo.senderName, summary: replyingTo.summary } : undefined}
                  mentionRequest={s.composerMentionRequest}
                  onMentionRequestConsumed={controller.clearMentionRequest}
                  onSubmit={(build, complete) => void controller.sendCurrentWebQQMessage(build, complete)}
                  onClearReply={controller.clearReplyTarget}
                  onPreviewAttachment={controller.openImagePreview}
                  onSendSpaceChange={(space) => controller.setSendSpace(space)}
                />
              ) : null}
              <CssTransition name="webqq-scroll-bottom" show={!s.trackingMessages && !!visibleMessages.length}>
                <button className="onebot-webqq-webqq__scroll-bottom" type="button" aria-label={t('webqq.chat.scrollBottom')} onClick={controller.returnMessagesToBottom}>
                  <svg className="onebot-webqq-webqq__scroll-bottom-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14"></path>
                    <path d="m7 14 5 5 5-5"></path>
                  </svg>
                </button>
              </CssTransition>
            </div>
          </div>
        </div>
        {s.groupInfoOpen && currentChat?.type === 'group' ? <WebQQGroupInfoPanel c={controller} s={s} /> : null}
      </section>
      {s.forwardDialog ? <WebQQForwardModal c={controller} dialog={s.forwardDialog} settings={settings} /> : null}
      {s.imagePreviewUrl ? <WebQQImagePreview url={s.imagePreviewUrl} onClose={controller.closeImagePreview} /> : null}
      {s.reactionPickerMessageId ? <WebQQEmojiPicker onClose={() => controller.setReactionPickerOpen(false)} onSelect={controller.selectReaction} /> : null}
      <WebQQForwardTargetDialog open={s.forwardTargetOpen} model={forwardTargets} onOpenChange={controller.setForwardTargetOpen} onConfirm={controller.confirmSelectionForward} />
      {s.profileCardOpen && s.profileCardModel ? (
        <WebQQProfileCard model={s.profileCardModel} onClose={() => controller.setProfileCardOpen(false)} onSave={controller.handleSaveSelfProfile} />
      ) : null}
      <WebQQConfirmDialog spec={s.confirmDialogSpec} onOpenChange={controller.setConfirmDialogOpen} onConfirm={controller.confirmDestructiveAction} />
      <WebQQActionDialog spec={s.actionDialogSpec} onOpenChange={controller.setActionDialogOpen} onConfirm={controller.confirmActionDialog} />
      {settings.allowWebQQResize ? (
        <>
          <span className="onebot-webqq-webqq__resize-zone is-left" aria-hidden="true" onPointerDown={(event) => startResize('left', event)}></span>
          <span className="onebot-webqq-webqq__resize-zone is-top" aria-hidden="true" onPointerDown={(event) => startResize('top', event)}></span>
          <span className="onebot-webqq-webqq__resize-zone is-top-left" aria-hidden="true" onPointerDown={(event) => startResize('top-left', event)}></span>
        </>
      ) : null}
    </div>
  )
}
