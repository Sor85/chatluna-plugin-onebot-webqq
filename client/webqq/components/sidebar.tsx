import * as React from 'react'
import { createPortal } from 'react-dom'
import { IconId, IconLogout, IconTag, IconTrash, IconUserMinus } from '@tabler/icons-react'
import { useT } from '../../i18n'
import { useStore } from '../../shared/store'
import { config } from '../../runtime'
import type { WebQQController, WebQQState } from '../controller'
import type { WebQQFriend, WebQQGroup, WebQQNotice } from '../types'
import {
  getContactSubtitle,
  getContactTime,
  getGroupSubtitle,
  getVisibleFriendCategories,
  getVisibleFriends,
  getVisibleGroups,
  type WebQQRecentItem,
} from '../utils/webqq-contact-view'
import { rememberFloatingPanelAnchor } from '../utils/floating-panel'
import { getDesktopNoticeMenuPosition } from '../utils/notice-menu-position'
import { canHandleNotice, formatNoticeComment, getHandledNoticeStatusText } from '../utils/webqq-notice-view'
import { formatNoticeTime, formatTime, getUnreadText } from '../utils/webqq-message-view'
import { showWebQQPopover } from '../utils/webqq-popover'
import { useWebQQScrollbar } from '../utils/webqq-scrollbar'
import { getWebQQAccentStyle } from '../utils/webqq-theme-view'
import {
  useResolvedColorMode,
  WebQQContextMenu,
  WebQQContextMenuContent,
  WebQQContextMenuItem,
  WebQQContextMenuTrigger,
} from '../ui'

type ContactType = 'friend' | 'group'

/** 右键菜单的落点记在全局，资料卡等浮层据此就近打开。 */
const anchorHandlers = {
  onPointerDown: (event: React.PointerEvent) => {
    if (event.button === 2) rememberFloatingPanelAnchor(event.nativeEvent)
  },
  onContextMenuCapture: (event: React.MouseEvent) => rememberFloatingPanelAnchor(event.nativeEvent),
}

function ContactAvatar(props: { name: string, avatar?: string, unread: number }) {
  return (
    <span className="onebot-webqq-webqq__contact-avatar">
      {props.avatar
        ? <img src={props.avatar} alt={props.name} />
        : <span className="onebot-webqq-webqq__contact-avatar-fallback" aria-hidden="true">{props.name.slice(0, 1)}</span>}
      {props.unread ? <span className="onebot-webqq-webqq__contact-unread">{getUnreadText(props.unread)}</span> : null}
    </span>
  )
}

function ContactRow(props: {
  name: string
  avatar?: string
  subtitle: string
  time: number
  unread: number
  active: boolean
  onSelect: () => void
  menu: React.ReactNode
}) {
  return (
    <WebQQContextMenu>
      <WebQQContextMenuTrigger
        render={(
          <button
            className={['onebot-webqq-webqq__contact', props.active ? 'is-active' : ''].filter(Boolean).join(' ')}
            type="button"
            onClick={props.onSelect}
            {...anchorHandlers}
          />
        )}
      >
        <ContactAvatar name={props.name} avatar={props.avatar} unread={props.unread} />
        <span className="onebot-webqq-webqq__contact-info">
          <strong>{props.name}</strong>
          <small>{props.subtitle}</small>
        </span>
        {props.time ? <time className="onebot-webqq-webqq__contact-time">{formatTime(props.time)}</time> : null}
      </WebQQContextMenuTrigger>
      <WebQQContextMenuContent>{props.menu}</WebQQContextMenuContent>
    </WebQQContextMenu>
  )
}

function MenuItem(props: { icon: React.ReactNode, label: string, danger?: boolean, onClick: () => void }) {
  return (
    <WebQQContextMenuItem className={props.danger ? 'is-danger' : undefined} onClick={props.onClick}>
      {props.icon} {props.label}
    </WebQQContextMenuItem>
  )
}

export function WebQQContactList(props: { c: WebQQController, s: WebQQState }) {
  const { c, s } = props
  const t = useT()
  const scrollbar = useWebQQScrollbar<HTMLDivElement>({ hideOnNarrow: true })
  const recentItems = React.useMemo(() => c.recentItems(), [s.contacts, s.conversationSummaries, s.hiddenRecentKeys])
  const friendCategories = React.useMemo(() => getVisibleFriendCategories(s.contacts, s.searchQuery), [s.contacts, s.searchQuery, t])
  const visibleFriends = React.useMemo(() => getVisibleFriends(s.contacts, s.searchQuery), [s.contacts, s.searchQuery])
  const visibleGroups = React.useMemo(() => getVisibleGroups(s.contacts, s.searchQuery), [s.contacts, s.searchQuery])
  const currentPeerId = s.currentChat?.peerId
  const subtitle = (type: ContactType, peerId: string, fallback: string) => getContactSubtitle(s.conversationSummaries, type, peerId, fallback)
  const time = (type: ContactType, peerId: string, fallback?: number) => getContactTime(s.conversationSummaries, type, peerId, fallback)
  const icon = (Icon: typeof IconId) => <Icon size={16} aria-hidden="true" />

  return (
    <div ref={scrollbar} className="onebot-webqq-webqq__list">
      {s.activeTab === 'recent' ? (
        <>
          {recentItems.map((item: WebQQRecentItem) => (
            <ContactRow
              key={`recent:${item.type}:${item.peerId}`}
              name={item.name}
              avatar={item.avatar}
              subtitle={subtitle(item.type, item.peerId, item.summary || item.subtitle)}
              time={time(item.type, item.peerId, item.time)}
              unread={c.getUnreadCount(item.type, item.peerId)}
              active={currentPeerId === item.peerId}
              onSelect={() => c.selectRecent(item)}
              menu={(
                <>
                  <MenuItem icon={icon(IconId)} label={t('webqq.menu.viewProfile')} onClick={() => c.openContactProfile(item.type, item.peerId)} />
                  {item.type === 'friend' ? <MenuItem icon={icon(IconTag)} label={t('webqq.menu.setRemark')} onClick={() => c.openRemarkDialog(item.peerId)} /> : null}
                  <MenuItem icon={icon(IconTrash)} label={t('webqq.menu.deleteRecent')} onClick={() => c.handleDeleteRecent(item)} />
                  {item.type === 'friend'
                    ? <MenuItem danger icon={icon(IconUserMinus)} label={t('webqq.menu.deleteFriend')} onClick={() => c.confirmDeleteFriend(item.peerId)} />
                    : <MenuItem danger icon={icon(IconLogout)} label={t('webqq.menu.leaveGroup')} onClick={() => c.confirmLeaveGroup(item.peerId)} />}
                </>
              )}
            />
          ))}
          {!recentItems.length ? <div className="onebot-webqq-webqq__empty-list">{t('webqq.contacts.emptyRecent')}</div> : null}
        </>
      ) : s.activeTab === 'friends' ? (
        <>
          {friendCategories.map((category) => (
            <section key={category.id} className="onebot-webqq-webqq__friend-category">
              {category.id !== 'all' && category.name !== '好友' ? <h4 className="onebot-webqq-webqq__friend-category-title">{category.name}</h4> : null}
              {category.friends.map((friend: WebQQFriend) => (
                <ContactRow
                  key={friend.userId}
                  name={friend.name}
                  avatar={friend.avatar}
                  subtitle={subtitle('friend', friend.userId, friend.nickname)}
                  time={time('friend', friend.userId)}
                  unread={c.getUnreadCount('friend', friend.userId)}
                  active={currentPeerId === friend.userId}
                  onSelect={() => c.selectFriend(friend)}
                  menu={(
                    <>
                      <MenuItem icon={icon(IconId)} label={t('webqq.menu.viewProfile')} onClick={() => c.openContactProfile('friend', friend.userId)} />
                      <MenuItem icon={icon(IconTag)} label={t('webqq.menu.setRemark')} onClick={() => c.openRemarkDialog(friend.userId)} />
                      <MenuItem danger icon={icon(IconUserMinus)} label={t('webqq.menu.deleteFriend')} onClick={() => c.confirmDeleteFriend(friend.userId)} />
                    </>
                  )}
                />
              ))}
            </section>
          ))}
          {!visibleFriends.length ? <div className="onebot-webqq-webqq__empty-list">{t('webqq.contacts.emptyFriends')}</div> : null}
        </>
      ) : (
        <>
          {visibleGroups.map((group: WebQQGroup) => (
            <ContactRow
              key={group.groupId}
              name={group.name}
              avatar={group.avatar}
              subtitle={subtitle('group', group.groupId, getGroupSubtitle(group))}
              time={time('group', group.groupId)}
              unread={c.getUnreadCount('group', group.groupId)}
              active={currentPeerId === group.groupId}
              onSelect={() => c.selectGroup(group)}
              menu={(
                <>
                  <MenuItem icon={icon(IconId)} label={t('webqq.menu.viewProfile')} onClick={() => c.openContactProfile('group', group.groupId)} />
                  <MenuItem danger icon={icon(IconLogout)} label={t('webqq.menu.leaveGroup')} onClick={() => c.confirmLeaveGroup(group.groupId)} />
                </>
              )}
            />
          ))}
          {!visibleGroups.length ? <div className="onebot-webqq-webqq__empty-list">{t('webqq.contacts.emptyGroups')}</div> : null}
        </>
      )}
    </div>
  )
}

export const WebQQNoticeMenu = React.forwardRef<HTMLDivElement, {
  c: WebQQController
  s: WebQQState
  className?: string
  style?: React.CSSProperties
  popover?: 'manual'
}>(function WebQQNoticeMenu(props, ref) {
  const { c, s } = props
  const t = useT()
  const scrollbar = useWebQQScrollbar<HTMLDivElement>()
  const notices = c.filteredNotices()
  const renderNotice = (notice: WebQQNotice) => {
    const statusText = getHandledNoticeStatusText(notice)
    return (
      <article key={notice.id} className="onebot-webqq-webqq__notice-card">
        {notice.avatar
          ? <img className="onebot-webqq-webqq__notice-avatar" src={notice.avatar} alt={notice.title} />
          : <span className="onebot-webqq-webqq__notice-avatar"></span>}
        <div className="onebot-webqq-webqq__notice-main">
          <strong className="onebot-webqq-webqq__notice-title">{notice.title}</strong>
          <span>{notice.subtitle}</span>
          {notice.comment ? formatNoticeComment(notice.comment).map((line) => (
            <small key={line} className="onebot-webqq-webqq__notice-comment">{line}</small>
          )) : null}
        </div>
        <div className="onebot-webqq-webqq__notice-side">
          {canHandleNotice(notice) ? (
            <span className="onebot-webqq-webqq__notice-actions">
              <button type="button" disabled={s.handlingNoticeId === notice.id} onClick={() => void c.handleNotice(notice, true)}>{t('webqq.notice.approve')}</button>
              <button type="button" disabled={s.handlingNoticeId === notice.id} onClick={() => void c.handleNotice(notice, false)}>{t('webqq.notice.reject')}</button>
            </span>
          ) : statusText ? (
            <span className={['onebot-webqq-webqq__notice-result', `is-${notice.status}`].join(' ')}>{statusText}</span>
          ) : null}
          {notice.time ? <time className="onebot-webqq-webqq__notice-time">{formatNoticeTime(notice.time)}</time> : null}
        </div>
      </article>
    )
  }
  return (
    <div
      ref={ref}
      popover={props.popover}
      className={['onebot-webqq-webqq__notice-menu', props.className].filter(Boolean).join(' ')}
      style={props.style}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="onebot-webqq-webqq__notice-tabs">
        <button className={s.noticeMenuTab === 'friends' ? 'is-active' : undefined} type="button" onClick={() => c.setNoticeMenuTab('friends')}>{t('webqq.notice.friendRequests')}</button>
        <button className={s.noticeMenuTab === 'groups' ? 'is-active' : undefined} type="button" onClick={() => c.setNoticeMenuTab('groups')}>{t('webqq.notice.groupNotices')}</button>
      </div>
      <div ref={scrollbar} className="onebot-webqq-webqq__notice-menu-body">
        {s.noticeLoading ? <div className="onebot-webqq-webqq__notice-empty">{t('webqq.common.loading')}</div>
          : s.noticeErrorText ? <div className="onebot-webqq-webqq__notice-empty is-error">{s.noticeErrorText}</div>
            : !notices.length ? <div className="onebot-webqq-webqq__notice-empty">{t('webqq.notice.empty')}</div>
              : <div className="onebot-webqq-webqq__notices">{notices.map(renderNotice)}</div>}
      </div>
    </div>
  )
})

/** 桌面端的通知菜单 Portal 到 body，并提升到 Top Layer，毛玻璃才能采样到观察窗。位置跟随通知按钮。 */
function DesktopNoticeMenu(props: { c: WebQQController, s: WebQQState, anchor: React.RefObject<HTMLButtonElement | null> }) {
  const { c, s, anchor } = props
  const settings = useStore(config)
  const colorMode = useResolvedColorMode()
  const [position, setPosition] = React.useState({ top: 0, left: 0 })
  const menu = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const update = () => {
      const button = anchor.current
      if (button) setPosition(getDesktopNoticeMenuPosition(button.getBoundingClientRect()))
    }
    update()
    showWebQQPopover(menu.current)
    window.addEventListener('resize', update)
    const root = anchor.current?.closest('.onebot-webqq-webqq')
    const observer = root && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined
    if (root) observer?.observe(root)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [anchor])

  return createPortal(
    <WebQQNoticeMenu
      ref={menu}
      c={c}
      s={s}
      popover="manual"
      className={['onebot-webqq-webqq__notice-menu--desktop', settings.enableWebQQFrostedGlass ? 'is-frosted' : 'is-plain', `is-color-${colorMode}`].join(' ')}
      style={{ ...getWebQQAccentStyle(settings.webQQAccentColor), top: `${position.top}px`, left: `${position.left}px` } as React.CSSProperties}
    />,
    document.body,
  )
}

export function WebQQSidebar(props: { c: WebQQController, s: WebQQState }) {
  const { c, s } = props
  const t = useT()
  const notifyButton = React.useRef<HTMLButtonElement>(null)
  const tab = (value: WebQQState['activeTab'], label: string, icon: React.ReactNode) => (
    <button className={s.activeTab === value ? 'is-active' : undefined} type="button" onClick={() => c.selectTab(value)}>
      {icon}
      {label}
    </button>
  )
  return (
    <aside className="onebot-webqq-webqq__sidebar">
      <div className="onebot-webqq-webqq__tabs-row">
        <div className="onebot-webqq-webqq__tabs">
          {tab('recent', t('webqq.tabs.recent'), (
            <svg className="onebot-webqq-webqq__tab-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9"></circle>
              <path d="M12 7v5l3 2"></path>
            </svg>
          ))}
          {tab('friends', t('webqq.tabs.friends'), (
            <svg className="onebot-webqq-webqq__tab-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="4"></circle>
              <path d="M5 21a7 7 0 0 1 14 0"></path>
            </svg>
          ))}
          {tab('groups', t('webqq.tabs.groups'), (
            <svg className="onebot-webqq-webqq__tab-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="9" cy="8" r="3.5"></circle>
              <circle cx="17" cy="9" r="3"></circle>
              <path d="M2.5 21a6.5 6.5 0 0 1 13 0"></path>
              <path d="M14 16.5A5 5 0 0 1 21.5 21"></path>
            </svg>
          ))}
        </div>
        <span className="onebot-webqq-webqq__notify-wrap" onClick={(event) => event.stopPropagation()}>
          <button
            ref={notifyButton}
            className={['onebot-webqq-webqq__notify', s.noticeOpen ? 'is-active' : ''].filter(Boolean).join(' ')}
            type="button"
            aria-label={t('webqq.notice.title')}
            onClick={c.openNotices}
          >
            <svg className="onebot-webqq-webqq__notify-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 18a3 3 0 0 1-6 0"></path>
              <path d="M19 16H5c1.4-1.4 2-3.2 2-5.5a5 5 0 0 1 10 0c0 2.3.6 4.1 2 5.5Z"></path>
            </svg>
          </button>
          {s.noticeOpen ? <DesktopNoticeMenu c={c} s={s} anchor={notifyButton} /> : null}
        </span>
      </div>
      {s.activeTab !== 'recent' ? (
        <div className="onebot-webqq-webqq__search">
          <svg className="onebot-webqq-webqq__search-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7"></circle>
            <path d="m16 16 4 4"></path>
          </svg>
          <input
            value={s.searchQuery}
            type="text"
            placeholder={s.activeTab === 'friends' ? t('webqq.contacts.searchFriends') : t('webqq.contacts.searchGroups')}
            onChange={(event) => c.setSearchQuery(event.target.value)}
          />
        </div>
      ) : null}
      <WebQQContactList c={c} s={s} />
    </aside>
  )
}
