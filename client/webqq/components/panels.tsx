import * as React from 'react'
import { useT } from '../../i18n'
import type { MirroredConfigValues } from '../../../src/config/spec'
import type { WebQQController, WebQQState } from '../controller'
import type { WebQQForwardItem, WebQQGroupMember } from '../types'
import { rememberFloatingPanelAnchor } from '../utils/floating-panel'
import { createImagePreviewZoom, IMAGE_PREVIEW_ZOOM_MIN } from '../utils/image-preview-zoom'
import {
  formatNoticeTime,
  getForwardItemAvatar,
  getForwardItemClusterClass,
  getForwardItemName,
  getGroupMemberName,
  getWebQQElementRuns,
  isMergedForwardItem,
  type WebQQMessageElement,
} from '../utils/webqq-message-view'
import { useWebQQScrollbar } from '../utils/webqq-scrollbar'
import { WebQQContextMenu, WebQQContextMenuTrigger } from '../ui'
import { WebQQGroupMemberMenu } from './shared'

const DEFAULT_FORWARD_AVATAR = 'https://q1.qlogo.cn/g?b=qq&nk=0&s=640'

/** 群信息栏：群公告与群成员。成员右键是独立的群成员菜单（含 @ 与戳一戳）。 */
export function WebQQGroupInfoPanel(props: { c: WebQQController, s: WebQQState }) {
  const { c, s } = props
  const t = useT()
  const announcementsScrollbar = useWebQQScrollbar<HTMLElement>()
  const membersScrollbar = useWebQQScrollbar<HTMLDivElement>()
  const groupInfo = s.groupInfo
  const hasGroupInfo = groupInfo.announcements.length > 0 || groupInfo.members.length > 0
  const visibleMembers = React.useMemo(() => c.visibleGroupMembers(), [groupInfo, s.groupInfoSearchQuery])
  const actor = groupInfo.members.find((member) => member.userId === c.currentOperatorId)
  const placeholder = (empty: string, isEmpty: boolean) => s.groupInfoLoading && !hasGroupInfo
    ? <div className="onebot-webqq-webqq__group-empty">{t('webqq.common.loading')}</div>
    : s.groupInfoErrorText
      ? <div className="onebot-webqq-webqq__group-empty is-error">{s.groupInfoErrorText}</div>
      : isEmpty ? <div className="onebot-webqq-webqq__group-empty">{empty}</div> : undefined

  return (
    <aside className="onebot-webqq-webqq__group-info">
      <header className="onebot-webqq-webqq__group-info-header">
        <strong>{t('webqq.group.title')}</strong>
      </header>
      <div className="onebot-webqq-webqq__group-info-body">
        <section ref={announcementsScrollbar} className="onebot-webqq-webqq__group-announcements">
          <h3>{t('webqq.group.announcements')}</h3>
          {placeholder(t('webqq.group.emptyAnnouncements'), !groupInfo.announcements.length) ?? groupInfo.announcements.map((announcement) => (
            <article key={announcement.id} className="onebot-webqq-webqq__group-announcement">
              <p>{announcement.content}</p>
              {announcement.time ? <time>{formatNoticeTime(announcement.time)}</time> : null}
            </article>
          ))}
        </section>
        <section className="onebot-webqq-webqq__group-members">
          <h3>{t('webqq.group.members')}</h3>
          <input value={s.groupInfoSearchQuery} type="text" placeholder={t('webqq.group.searchMembers')} onChange={(event) => c.setGroupInfoSearchQuery(event.target.value)} />
          {placeholder(t('webqq.group.emptyMembers'), !visibleMembers.length) ?? (
            <div ref={membersScrollbar} className="onebot-webqq-webqq__group-member-list">
              {visibleMembers.map((member: WebQQGroupMember) => (
                <WebQQContextMenu key={member.userId}>
                  <WebQQContextMenuTrigger
                    render={(
                      <article
                        className="onebot-webqq-webqq__group-member"
                        onClick={(event) => void c.openUserProfile(member.userId, event.nativeEvent)}
                        onPointerDown={(event) => {
                          if (event.button === 2) rememberFloatingPanelAnchor(event.nativeEvent)
                        }}
                        onContextMenuCapture={(event) => rememberFloatingPanelAnchor(event.nativeEvent)}
                      />
                    )}
                  >
                    {member.avatar
                      ? <img src={member.avatar} alt={getGroupMemberName(member)} />
                      : <span className="onebot-webqq-webqq__group-member-avatar-fallback" aria-hidden="true">{getGroupMemberName(member).slice(0, 1)}</span>}
                    <span>
                      <strong>{getGroupMemberName(member)}</strong>
                      <small>{member.userId}</small>
                    </span>
                    {member.role ? <em>{member.role}</em> : null}
                  </WebQQContextMenuTrigger>
                  <WebQQGroupMemberMenu
                    actor={actor}
                    member={member}
                    onMention={() => c.handleMentionGroupMember(member.userId)}
                    onPoke={() => c.handlePokeGroupMember(member.userId)}
                    onSetCard={() => c.openGroupCardDialog(member.userId)}
                    onSetTitle={() => c.openGroupTitleDialog(member.userId)}
                    onSetAdmin={(enabled) => c.handleSetGroupAdmin(member.userId, enabled)}
                    onKick={() => c.handleKickGroupMember(member.userId)}
                  />
                </WebQQContextMenu>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}

/** 合并转发详情：观察窗内的浮层，消息行结构与普通消息一致，TIM 样式的合并与收角规则同样生效。 */
export function WebQQForwardModal(props: { c: WebQQController, dialog: WebQQMessageElement, settings: MirroredConfigValues }) {
  const { c, dialog, settings } = props
  const t = useT()
  const scrollbar = useWebQQScrollbar<HTMLDivElement>()
  const items = dialog.items ?? []
  const chatStyle = settings.webQQChatStyle

  const renderElement = (element: WebQQMessageElement, runIndex: number) => {
    if (element.type === 'quote') {
      return (
        <div key={runIndex} className="onebot-webqq-webqq__quote">
          {element.title ? <strong className="onebot-webqq-webqq__quote-title">{element.title}</strong> : null}
          <span>{element.text || '[引用消息]'}</span>
        </div>
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
          <span>{element.text || '[合并转发]'}</span>
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
    return <span key={runIndex}>{element.text || '[消息]'}</span>
  }

  const renderItem = (item: WebQQForwardItem, itemIndex: number) => {
    const merged = isMergedForwardItem(items, itemIndex, chatStyle)
    const avatar = getForwardItemAvatar(item, DEFAULT_FORWARD_AVATAR)
    const name = getForwardItemName(item)
    return (
      <article key={itemIndex} className={['onebot-webqq-webqq__message', 'is-incoming', getForwardItemClusterClass(items, itemIndex, chatStyle), merged ? 'is-merged' : ''].filter(Boolean).join(' ')}>
        {/* TIM 合并项依赖 wrapper 保留头像占位并隐藏重复头像，弹窗需和普通消息保持同一结构。 */}
        <span className="onebot-webqq-webqq__message-avatar-wrap">
          {avatar
            ? <img className="onebot-webqq-webqq__message-avatar" src={avatar} alt={name} />
            : <span className="onebot-webqq-webqq__message-avatar is-fallback" aria-hidden="true">{name.slice(0, 1)}</span>}
        </span>
        <div className="onebot-webqq-webqq__message-content">
          {!merged ? <div className="onebot-webqq-webqq__sender-line"><span className="onebot-webqq-webqq__message-name">{name}</span></div> : null}
          <div className="onebot-webqq-webqq__message-body">
            <div className="onebot-webqq-webqq__bubble">
              {getWebQQElementRuns(item.elements).map((run, runIndex) => run.type === 'inline' ? (
                <span key={runIndex} className="onebot-webqq-webqq__inline-run">
                  {run.elements.map((element, elementIndex) => element.type === 'text'
                    ? <span key={elementIndex}>{element.text}</span>
                    : element.type === 'face' && element.emojiUrl
                      ? <img key={elementIndex} className="onebot-webqq-webqq__message-face" src={element.emojiUrl} alt={element.text || t('webqq.chat.face')} onLoad={c.handleMessageImageLoad} />
                      : <span key={elementIndex}>{element.text || '[消息]'}</span>)}
                </span>
              ) : renderElement(run.element, runIndex))}
            </div>
          </div>
        </div>
      </article>
    )
  }

  return (
    <div
      className="onebot-webqq-webqq__forward-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('webqq.forward.title')}
      tabIndex={0}
      onClick={(event) => {
        if (event.target === event.currentTarget) c.closeForwardDialog()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') c.closeForwardDialog()
      }}
    >
      <div className="onebot-webqq-webqq__forward-modal" onClick={(event) => event.stopPropagation()}>
        <header className="onebot-webqq-webqq__forward-modal-header">
          <strong>{dialog.title || '合并转发'}</strong>
          <button type="button" aria-label={t('webqq.forward.close')} onClick={c.closeForwardDialog}>
            <svg className="onebot-webqq-webqq__header-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12"></path>
              <path d="M18 6L6 18"></path>
            </svg>
          </button>
        </header>
        <div ref={scrollbar} className="onebot-webqq-webqq__forward-modal-body">
          {items.map(renderItem)}
          {!items.length ? <div className="onebot-webqq-webqq__forward-modal-empty">{t('webqq.chat.empty')}</div> : null}
        </div>
      </div>
    </div>
  )
}

/** 图片预览：滚轮以指针为锚点缩放，放大后可拖动平移；拖动后松手不触发关闭。 */
export function WebQQImagePreview(props: { url: string, onClose: () => void }) {
  const t = useT()
  const overlay = React.useRef<HTMLDivElement>(null)
  const image = React.useRef<HTMLImageElement>(null)
  const [, forceRender] = React.useReducer((value: number) => value + 1, 0)
  const zoom = React.useMemo(() => createImagePreviewZoom({
    // transform 不改图片布局盒，贴合尺寸始终以倍率 1 为基准。
    metrics: () => {
      const imageElement = image.current
      const overlayElement = overlay.current
      if (!imageElement || !overlayElement || !imageElement.offsetWidth) return undefined
      return {
        baseWidth: imageElement.offsetWidth,
        baseHeight: imageElement.offsetHeight,
        viewportWidth: overlayElement.clientWidth,
        viewportHeight: overlayElement.clientHeight,
      }
    },
    center: () => {
      const element = overlay.current
      if (!element) return undefined
      const rect = element.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    },
    captureTarget: () => image.current ?? undefined,
    onChange: forceRender,
  }), [])

  React.useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    overlay.current?.focus()
    // React 的 wheel 监听是被动的，preventDefault 拦不住页面滚动，原生监听才能缩放。
    const element = overlay.current
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoom.handleWheel(event)
    }
    element?.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      element?.removeEventListener('wheel', onWheel)
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [zoom])

  // 换图时不继承上一张的倍率与位移。
  React.useEffect(() => zoom.reset(), [props.url, zoom])

  const zoomed = zoom.scale.value > IMAGE_PREVIEW_ZOOM_MIN
  return (
    <div
      ref={overlay}
      className={['onebot-webqq-webqq__image-preview', zoomed ? 'is-zoomed' : ''].filter(Boolean).join(' ')}
      role="dialog"
      aria-modal="true"
      aria-label={t('webqq.preview.title')}
      tabIndex={0}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        event.stopPropagation()
        if (zoom.consumeSuppressedClick()) return
        props.onClose()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        props.onClose()
      }}
    >
      <button className="onebot-webqq-webqq__image-preview-close" type="button" aria-label={t('webqq.preview.close')} onClick={props.onClose}>
        <svg className="onebot-webqq-webqq__header-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12"></path>
          <path d="M18 6L6 18"></path>
        </svg>
      </button>
      <img
        ref={image}
        src={props.url}
        alt={t('webqq.preview.title')}
        style={{ transform: `translate(${zoom.offset.value.x}px, ${zoom.offset.value.y}px) scale(${zoom.scale.value})` }}
        draggable={false}
        onLoad={() => zoom.reset()}
        onPointerDown={(event) => {
          zoom.handlePointerDown(event)
          if (zoom.scale.value > IMAGE_PREVIEW_ZOOM_MIN) event.preventDefault()
        }}
        onPointerMove={(event) => zoom.handlePointerMove(event)}
        onPointerUp={(event) => zoom.finishDrag(event)}
        onPointerCancel={(event) => zoom.finishDrag(event)}
      />
      {zoomed ? <output className="onebot-webqq-webqq__image-preview-scale">{`${Math.round(zoom.scale.value * 100)}%`}</output> : null}
    </div>
  )
}
