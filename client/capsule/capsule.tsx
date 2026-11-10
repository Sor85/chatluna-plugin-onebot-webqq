import * as React from 'react'
import { useLocation } from 'react-router'
import { animate, createLayout, type AutoLayout } from 'animejs'
import { IconRobot } from '@tabler/icons-react'
import { readStored, writeStored } from '@chatluna/ui-storage'
import { useT } from '../i18n'
import { useStore } from '../shared/store'
import { CssTransition } from '../shared/transition'
import {
  availableBots as runtimeBots,
  capsule as capsuleStore,
  capsuleAnchor as capsuleAnchorStore,
  config as configStore,
  hostColorMode,
  selectedBotSelfId as selectedBotSelfIdStore,
  selectWebQQBot,
  webQQOpen as webQQOpenStore,
  webQQTotalUnread as webQQTotalUnreadStore,
  type OneBotRobotProfile,
} from '../runtime'
import { getWebQQAccentStyle } from '../webqq/utils/webqq-theme-view'
import { resolveWebQQColorMode } from '../webqq/utils/webqq-color-mode'
import { AVATAR_GUIDE_PULSE_COUNT, createAvatarGuideMotion, type AvatarGuideMotion } from './avatar-guide'
import {
  CAPSULE_ANCHOR_VIEWPORT_MARGIN,
  CAPSULE_DOCK_PEEK,
  clampCapsuleAnchor,
  normalizeCapsuleAnchorPosition,
  resolveCapsuleDock,
  type CapsuleAnchor,
  type CapsuleDockSide,
} from './capsule-anchor'

const BOT_STACK_ANIMATION_DURATION = 260
const BOT_AVATAR_OVERLAP_COLLAPSED_CENTER = 45
const BOT_AVATAR_OVERLAP_EXPANDED_CENTER = 52
// 位移阈值：整枚小胶囊都是拖动把手，头像同时还要能点开观察窗、切换机器人，
// 因此指针必须先明确移动够远才算拖动，阈值以内松手仍然走原来的点击路径。
const CAPSULE_DRAG_THRESHOLD = 4
// 指针离开贴边胶囊后的收回延迟，避免划过边缘时来回抖动。
const CAPSULE_DOCK_HIDE_DELAY = 400
// 单机器人胶囊的宽度，与样式表 --onebot-webqq-shell-collapsed-width 的默认值一致。
const CAPSULE_SINGLE_WIDTH = 204
const THINKING_ACTIVITY = '正在思考'

export const BOT_PROFILE_STORAGE_KEY = 'chatluna.onebot-webqq.bot-profile'
const CAPSULE_ANCHOR_STORAGE_KEY = 'chatluna.onebot-webqq.capsule-anchor'
const AVATAR_GUIDE_STORAGE_KEY = 'chatluna.onebot-webqq.avatar-guide'

// Universal.Status：1 在线，2 连接中，4 重连中。
const STATUS_ONLINE = 1
const STATUS_CONNECT = 2
const STATUS_RECONNECT = 4

type BotStackOverflowMotion = 'idle' | 'expanding' | 'collapsing'

interface CapsuleDragSession {
  readonly pointerId: number
  readonly startX: number
  readonly startY: number
  readonly startAnchor: CapsuleAnchor
  dragging: boolean
  dock?: CapsuleDockSide
}

function readCachedBotProfile() {
  const data = readStored(BOT_PROFILE_STORAGE_KEY)
  if (!data || typeof data !== 'object') return { name: '', avatar: '' }
  const name = Reflect.get(data, 'name')
  const avatar = Reflect.get(data, 'avatar')
  return {
    name: typeof name === 'string' ? name : '',
    avatar: typeof avatar === 'string' ? avatar : '',
  }
}

function getBotStatusClass(bot?: Pick<OneBotRobotProfile, 'status'>) {
  switch (bot?.status) {
    case STATUS_ONLINE:
      return 'is-online'
    case STATUS_CONNECT:
    case STATUS_RECONNECT:
      return 'is-pending'
    default:
      return 'is-offline'
  }
}

function getCapsuleUnreadText(count: number) {
  return count > 99999 ? '99999+' : String(count)
}

function hasTextOverflow(element?: HTMLElement | null) {
  return !!element && element.scrollWidth > element.clientWidth + 1
}

function getCapsuleViewport() {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** 路由 ID 是不带参数的路径（`/chat/:sessionId?` → `/chat`）；当前页属于它本身或它的子路径。 */
function isHiddenRoute(pathname: string, hiddenIds: readonly string[]) {
  return hiddenIds.some((id) => id && (pathname === id || pathname.startsWith(`${id}/`)))
}

/**
 * 头像强调波纹的进出场。原版是带 JS 钩子的 Vue Transition：显示时挂载节点并跑进场与波纹，
 * 隐藏时先播离场，播完再卸载。
 */
function AvatarGuide(props: { visible: boolean, motion: AvatarGuideMotion }) {
  const { visible, motion } = props
  const [mounted, setMounted] = React.useState(visible)
  const element = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (visible) setMounted(true)
  }, [visible])

  React.useLayoutEffect(() => {
    const node = element.current
    if (!mounted || !node) return
    if (visible) {
      motion.enter(node, () => {})
      return
    }
    motion.leave(node, () => setMounted(false))
  }, [mounted, visible, motion])

  if (!mounted) return null
  return (
    <span ref={element} className="onebot-webqq__avatar-guide" aria-hidden="true">
      <span className="onebot-webqq__avatar-guide-ring"></span>
      {Array.from({ length: AVATAR_GUIDE_PULSE_COUNT }, (_, index) => (
        <span key={index} className="onebot-webqq__avatar-guide-pulse"></span>
      ))}
    </span>
  )
}

function BotAvatarIcon() {
  return <IconRobot className="onebot-webqq__avatar-icon" stroke={1.75} aria-hidden="true" />
}

export function Capsule(props: { children?: React.ReactNode }) {
  const t = useT()
  const location = useLocation()
  const config = useStore(configStore)
  const capsule = useStore(capsuleStore)
  const runtimeBotList = useStore(runtimeBots)
  const selectedBotSelfId = useStore(selectedBotSelfIdStore)
  const webQQOpen = useStore(webQQOpenStore)
  const webQQTotalUnread = useStore(webQQTotalUnreadStore)
  const capsuleAnchor = useStore(capsuleAnchorStore)
  const resolvedColorMode = resolveWebQQColorMode(config.webQQColorMode, useStore(hostColorMode))

  const capsuleHost = React.useRef<HTMLDivElement>(null)
  const capsuleLayoutRef = React.useRef<HTMLDivElement>(null)
  const titleRef = React.useRef<HTMLDivElement>(null)
  const activityRef = React.useRef<HTMLSpanElement>(null)
  const activityUserRef = React.useRef<HTMLSpanElement>(null)
  const tooltipRef = React.useRef<HTMLDivElement>(null)

  const [cachedBotProfile, setCachedBotProfile] = React.useState(readCachedBotProfile)
  const [avatarGuideVisible, setAvatarGuideVisible] = React.useState(false)
  const avatarGuideMotion = React.useMemo(() => createAvatarGuideMotion(), [])
  // 每次显示引导递增，用来重启自动收起计时。
  const [avatarGuideRun, setAvatarGuideRun] = React.useState(0)
  const [botStackExpanded, setBotStackExpandedState] = React.useState(false)
  const botStackHovered = React.useRef(false)
  const botStackFocused = React.useRef(false)
  const [botStackOverflowMotion, setBotStackOverflowMotion] = React.useState<BotStackOverflowMotion>('idle')
  const botStackOverflowMotionTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  // Chrome 会在 click 时聚焦 <button>，切换 bot 时 React 把这个聚焦节点移到最右会触发一次
  // relatedTarget 为 null 的 focusout。切换期间挂起折叠，避免它取消正在进行的切换 FLIP。
  const suppressStackCollapse = React.useRef(false)
  const suppressStackCollapseTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  const [titleOverflow, setTitleOverflow] = React.useState(false)
  const [activityOverflow, setActivityOverflow] = React.useState(false)
  const [tooltipTarget, setTooltipTarget] = React.useState<'title' | 'activity'>()
  const [tooltipLeft, setTooltipLeft] = React.useState(0)
  const [capsuleDragging, setCapsuleDragging] = React.useState(false)
  const capsuleDragSession = React.useRef<CapsuleDragSession>(undefined)
  const [dockHovered, setDockHovered] = React.useState(false)
  const [dockFocused, setDockFocused] = React.useState(false)
  const [dockSettled, setDockSettled] = React.useState(false)
  const dockSlideRef = React.useRef<HTMLDivElement>(null)
  const dockHideTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  const botStackLayout = React.useRef<AutoLayout>(undefined)
  /** 记录了布局快照、等提交后播放的 FLIP；在 useLayoutEffect 里取出执行。 */
  const pendingLayoutAnimation = React.useRef<() => Promise<void>>(undefined)

  const shouldShowCapsule = !isHiddenRoute(location.pathname, config.hiddenCapsuleActivityIds)
  const availableBots = capsule?.bots?.length ? capsule.bots : runtimeBotList
  const hasMultipleBots = availableBots.length > 1
  const selectedBot = availableBots.find((bot) => bot.selfId === selectedBotSelfId)
  const displayBotProfile = selectedBot ?? capsule?.bot
  const activeBotSelfId = displayBotProfile?.selfId || selectedBotSelfId
  const botStackBots = React.useMemo(() => {
    const activeIndex = availableBots.findIndex((bot) => bot.selfId === activeBotSelfId)
    return activeIndex > 0
      ? [availableBots[activeIndex]!, ...availableBots.slice(0, activeIndex), ...availableBots.slice(activeIndex + 1)]
      : availableBots
  }, [availableBots, activeBotSelfId])
  const collapsedBotVisibleCount = Math.min(botStackBots.length, 3)
  const collapsedBotOverflowCount = Math.max(0, botStackBots.length - collapsedBotVisibleCount)
  const hasBotStackOverflow = collapsedBotOverflowCount > 0
  const botStackVisualExpanded = botStackExpanded || !hasBotStackOverflow
  const botOverflowPreview = botStackBots[collapsedBotVisibleCount]
  const collapsedBotStackWidth = 42 + Math.max(0, collapsedBotVisibleCount - 1) * 24 + (collapsedBotOverflowCount ? 24 : 0)
  const expandedBotStackWidth = 42 + Math.max(0, botStackBots.length - 1) * 31
  const getBotName = (bot?: Pick<OneBotRobotProfile, 'name' | 'selfId'>) => {
    const name = bot?.name?.trim()
    return name && name !== bot?.selfId ? name : t('capsule.bot')
  }
  const displayBotName = displayBotProfile?.name || cachedBotProfile.name || t('capsule.idle')
  const displayBotAvatar = displayBotProfile?.avatar || cachedBotProfile.avatar || ''
  const capsuleUnreadText = getCapsuleUnreadText(webQQTotalUnread)
  const showUnread = config.showWebQQCapsuleUnread && !!webQQTotalUnread
  const capsuleButtonLabel = showUnread
    ? t('capsule.openWithUnread', { count: capsuleUnreadText })
    : t('capsule.open')
  const titleStatusText = capsule?.conversation.activityText === THINKING_ACTIVITY ? t('capsule.thinking') : ''
  const conversationUserName = capsule?.conversation.userName || ''
  const conversation = capsule?.conversation
  const displayActivityText = !conversation
    ? t('capsule.idleActivity')
    : conversationUserName
      ? t('capsule.talking', { name: conversationUserName })
      : conversation.activityText && conversation.activityText !== THINKING_ACTIVITY
        ? conversation.activityText
        : t('capsule.idleActivity')
  const activityTooltipText = conversationUserName || displayActivityText
  const capsuleTooltipText = tooltipTarget === 'title' && titleOverflow
    ? displayBotName
    : tooltipTarget === 'activity' && activityOverflow
      ? activityTooltipText
      : ''
  const statusClass = getBotStatusClass(displayBotProfile)
  const capsuleDock = capsuleAnchor?.dock
  // 观察窗、拖动、首次引导与键盘焦点都需要完整胶囊，期间不收回。
  const dockHidden = !!capsuleDock && !capsuleDragging && !webQQOpen && !dockHovered && !dockFocused && !avatarGuideVisible

  // 收起位移真正停到边缘后才淡出把手里的残留内容、显示未读红点。不能用固定延迟：松手时指针常压在头像上，
  // 头像栈先展开再折叠会改写展开补偿，位移过渡被打断重来，实际收起时长不固定。
  React.useEffect(() => {
    if (!dockHidden) {
      setDockSettled(false)
      return
    }
    const slide = dockSlideRef.current
    if (!slide) return
    const sliding = slide.getAnimations().some((animation) => animation instanceof CSSTransition && animation.transitionProperty === 'translate')
    // 首屏直接以收起态渲染或减少动态效果时没有过渡可等。
    if (!sliding) {
      setDockSettled(true)
      return
    }
    const settle = (event: TransitionEvent) => {
      if (event.target === slide && event.propertyName === 'translate') setDockSettled(true)
    }
    slide.addEventListener('transitionend', settle)
    return () => slide.removeEventListener('transitionend', settle)
  }, [dockHidden])
  // 收起时按折叠宽度位移：悬停展开的头像栈在收回过程中同时折叠，按展开宽度算会把把手也推出视口。
  const collapsedShellWidth = hasMultipleBots ? 162 + collapsedBotStackWidth : CAPSULE_SINGLE_WIDTH
  const shellWidth = botStackVisualExpanded && hasMultipleBots ? 162 + expandedBotStackWidth : collapsedShellWidth
  // 胶囊以右侧为锚点，右缘在 viewport - right，宽度变化只改左缘。锚点 right 按拖动或恢复时量到的宽度夹取，
  // 机器人列表晚到、头像栈展开都会让它过期，因此位移一律按右缘直接推算。
  const viewportWidth = window.innerWidth
  const shellRight = capsuleAnchor ? viewportWidth - capsuleAnchor.right : 0
  const shellLeftGap = shellRight - shellWidth - CAPSULE_ANCHOR_VIEWPORT_MARGIN
  // 贴左时左缘始终对齐边距；其余位置只在展开越出左缘时右移补回。
  const capsuleShift = !capsuleAnchor ? 0 : capsuleDock === 'left' ? -shellLeftGap : Math.max(0, -shellLeftGap)
  // 收起时只露出把手：贴左把右缘推到把手处，贴右按折叠宽度把左缘推到视口内把手处。
  const dockOffset = capsuleDock === 'left'
    ? CAPSULE_DOCK_PEEK - shellRight
    : (viewportWidth - CAPSULE_DOCK_PEEK) - (shellRight - collapsedShellWidth)

  const capsuleHostStyle = {
    ...getWebQQAccentStyle(config.webQQAccentColor),
    // 胶囊摘要文字是另一个 position: fixed 节点，但它在 host 的继承树里，因此拖动结果用自定义属性下发，
    // 一处写入两处生效。没拖动过时属性不存在，样式表里的默认锚点和窄屏媒体查询照旧生效。
    ...(capsuleAnchor ? {
      '--onebot-webqq-capsule-right': `${capsuleAnchor.right}px`,
      '--onebot-webqq-capsule-bottom': `${capsuleAnchor.bottom}px`,
    } : {}),
    // 贴边位移叠加在展开补偿之上，因此扣掉补偿。
    ...(capsuleDock ? { '--onebot-webqq-dock-slide': `${dockOffset - capsuleShift}px` } : {}),
    ...(capsuleShift ? { '--onebot-webqq-capsule-shift': `${capsuleShift}px` } : {}),
  } as React.CSSProperties
  const capsuleStyle = (hasMultipleBots ? {
    '--onebot-webqq-shell-collapsed-width': `${162 + collapsedBotStackWidth}px`,
    '--onebot-webqq-shell-width': `${162 + expandedBotStackWidth}px`,
  } : {}) as React.CSSProperties
  const avatarCapsuleStyle = (hasMultipleBots ? {
    '--onebot-webqq-avatar-capsule-collapsed-width': `${collapsedBotStackWidth + 8}px`,
    '--onebot-webqq-avatar-capsule-expanded-width': `${expandedBotStackWidth + 8}px`,
  } : {}) as React.CSSProperties
  const botStackStyle = {
    '--onebot-webqq-stack-collapsed-width': `${collapsedBotStackWidth}px`,
    '--onebot-webqq-stack-expanded-width': `${expandedBotStackWidth}px`,
  } as React.CSSProperties
  const isCoveredByExpandedAvatar = botStackExpanded || botStackOverflowMotion === 'expanding'
  const botOverflowStyle = {
    '--onebot-webqq-bot-overflow-right': `${collapsedBotVisibleCount * 24}px`,
    '--onebot-webqq-bot-overflow-expanded-right': `${collapsedBotVisibleCount * 31}px`,
    '--onebot-webqq-bot-overflow-z-index': `${botStackBots.length - collapsedBotVisibleCount - (isCoveredByExpandedAvatar ? 1 : 0)}`,
  } as React.CSSProperties

  const isBotCollapsedExtra = (index: number) => collapsedBotOverflowCount > 0 && index >= collapsedBotVisibleCount
  // 余量头像折叠态用 opacity 隐藏（不用 visibility:hidden）以保住 FLIP 位移补偿，
  // 因此折叠态要手动把它们移出 Tab 序与读屏树，展开后再恢复，避免出现不可见可聚焦按钮。
  const isBotCollapsedHidden = (index: number) => !botStackExpanded && isBotCollapsedExtra(index)
  const getBotSwitchStyle = (index: number) => ({
    // 折叠态把余量头像收拢到余量徽标的位置，再由徽标承接数量显示。
    // 收拢位与展开位都落在当前 bot 头像左侧，FLIP 在两端之间线性插值，余量头像不会越过当前头像。
    '--onebot-webqq-bot-collapsed-right': `${isBotCollapsedExtra(index) ? collapsedBotVisibleCount * 24 : index * 24}px`,
    '--onebot-webqq-bot-expanded-right': `${index * 31}px`,
    zIndex: String(botStackBots.length - index),
  }) as React.CSSProperties

  const ensureBotStackLayout = () => {
    if (botStackLayout.current || !capsuleLayoutRef.current) return botStackLayout.current
    // layout root 不能是 fixed 胶囊本体；用独立 wrapper 记录外层右锚定胶囊的左移，同时把右侧正文隔离在
    // wrapper 外，避免文字被 FLIP 位移。bot 按钮必须一起进入 FLIP，才能抵消外层胶囊向左扩张时对子节点的
    // 位移，保证当前 bot 头像屏幕坐标不动。
    botStackLayout.current = createLayout(capsuleLayoutRef.current, {
      children: ['.onebot-webqq', '.onebot-webqq__avatar-capsule', '.onebot-webqq__bot-stack', '.onebot-webqq__bot-switch', '.onebot-webqq__bot-overflow'],
    })
    return botStackLayout.current
  }

  /** 先记录当前布局，再提交新状态；FLIP 在提交后的 layout effect 里播放。 */
  const scheduleBotStackAnimation = (fromExpanded?: boolean, toExpanded?: boolean) => {
    const layout = ensureBotStackLayout()
    if (!layout) return Promise.resolve()
    layout.record()
    return new Promise<void>((resolve) => {
      pendingLayoutAnimation.current = async () => {
        const shouldAnimateOverlap = fromExpanded !== undefined && toExpanded !== undefined && fromExpanded !== toExpanded
        const avatars = shouldAnimateOverlap
          ? Array.from(capsuleLayoutRef.current?.querySelectorAll<HTMLElement>('.onebot-webqq__bot-switch.is-overlapped .onebot-webqq__avatar') ?? [])
          : []
        const fromCenter = fromExpanded ? BOT_AVATAR_OVERLAP_EXPANDED_CENTER : BOT_AVATAR_OVERLAP_COLLAPSED_CENTER
        const toCenter = toExpanded ? BOT_AVATAR_OVERLAP_EXPANDED_CENTER : BOT_AVATAR_OVERLAP_COLLAPSED_CENTER
        // bot-switch 本身没有 right 过渡，位置完全由 Anime.js FLIP 驱动；裁切若走独立 CSS transition
        // 会和 260ms out(3) 位移错相，必须放进同一条时间轴。
        const overlapAnimation = shouldAnimateOverlap
          ? animate(avatars, {
              '--onebot-webqq-avatar-overlap-center': [`${fromCenter}px`, `${toCenter}px`],
              duration: BOT_STACK_ANIMATION_DURATION,
              ease: 'out(3)',
            })
          : undefined
        await Promise.all([
          layout.animate({ duration: BOT_STACK_ANIMATION_DURATION, ease: 'out(3)' }),
          overlapAnimation?.then(),
        ])
        resolve()
      }
    })
  }

  React.useLayoutEffect(() => {
    const run = pendingLayoutAnimation.current
    if (!run) return
    pendingLayoutAnimation.current = undefined
    void run()
  })

  const botStackExpandedRef = React.useRef(botStackExpanded)
  botStackExpandedRef.current = botStackExpanded

  const setBotStackExpanded = (expanded: boolean) => {
    if (!hasMultipleBots || !hasBotStackOverflow) return
    const fromExpanded = botStackExpandedRef.current
    if (fromExpanded === expanded) return
    void scheduleBotStackAnimation(fromExpanded, expanded)
    setBotStackOverflowMotion(expanded ? 'expanding' : 'collapsing')
    clearTimeout(botStackOverflowMotionTimer.current)
    botStackOverflowMotionTimer.current = setTimeout(() => {
      setBotStackOverflowMotion('idle')
      botStackOverflowMotionTimer.current = undefined
    }, 280)
    botStackExpandedRef.current = expanded
    setBotStackExpandedState(expanded)
  }

  // 展开态由「指针悬停」或「焦点驻留」任一为真推导，而不是直接听 pointerleave/focusout，
  // 并在 selectBot 重排期间挂起折叠，避免伪 focusout 打断切换 FLIP。
  const syncBotStackExpanded = () => {
    if (suppressStackCollapse.current) return
    setBotStackExpanded(botStackHovered.current || botStackFocused.current)
  }

  const refreshCapsuleTextOverflow = React.useCallback(() => {
    const nextTitleOverflow = hasTextOverflow(titleRef.current)
    const nextActivityOverflow = conversationUserName
      ? hasTextOverflow(activityUserRef.current)
      : hasTextOverflow(activityRef.current)
    setTitleOverflow(nextTitleOverflow)
    setActivityOverflow(nextActivityOverflow)
    setTooltipTarget((target) => {
      if (target === 'title' && !nextTitleOverflow) return undefined
      if (target === 'activity' && !nextActivityOverflow) return undefined
      return target
    })
  }, [conversationUserName])

  const updateCapsuleTooltipPosition = React.useCallback(() => {
    const tooltip = tooltipRef.current
    const body = tooltip?.parentElement
    if (!body || !tooltip) {
      setTooltipLeft(0)
      return
    }
    const viewportMargin = 12
    const bodyRect = body.getBoundingClientRect()
    const tooltipWidth = Math.min(tooltip.offsetWidth, Math.max(0, window.innerWidth - viewportMargin * 2))
    const centeredLeft = bodyRect.width / 2 - tooltipWidth / 2
    const minLeft = viewportMargin - bodyRect.left
    const maxLeft = window.innerWidth - viewportMargin - bodyRect.left - tooltipWidth
    setTooltipLeft(Math.min(Math.max(centeredLeft, minLeft), maxLeft))
  }, [])

  React.useLayoutEffect(() => {
    if (capsuleTooltipText) updateCapsuleTooltipPosition()
  }, [capsuleTooltipText, updateCapsuleTooltipPosition])

  const showCapsuleTextTooltip = (target: 'title' | 'activity') => {
    const overflow = target === 'title'
      ? hasTextOverflow(titleRef.current)
      : conversationUserName ? hasTextOverflow(activityUserRef.current) : hasTextOverflow(activityRef.current)
    if (target === 'title') setTitleOverflow(overflow)
    else setActivityOverflow(overflow)
    setTooltipTarget(overflow ? target : undefined)
  }

  // 锚点的当前值只能量出来：窄屏媒体查询给的是另一组默认值，头像栈展开时 host 会变宽。
  const measureCapsuleAnchor = (): CapsuleAnchor | undefined => {
    const host = capsuleHost.current
    if (!host) return
    const rect = host.getBoundingClientRect()
    return {
      right: window.innerWidth - rect.right,
      bottom: window.innerHeight - rect.bottom,
      width: rect.width,
      height: rect.height,
    }
  }

  // 拖完那一下必然还会派发一次 click，必须吃掉，否则松手瞬间会顺带打开观察窗或切换机器人。
  // 挂在 host 的捕获阶段：头像按钮、头像栈按钮和摘要文字共用 host 这个祖先。
  const blockCapsuleClick = React.useRef((event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    capsuleHost.current?.removeEventListener('click', blockCapsuleClick.current, true)
  })

  const releaseCapsuleClickSuppression = () => {
    capsuleHost.current?.removeEventListener('click', blockCapsuleClick.current, true)
  }

  const handleCapsuleDragMove = React.useRef((event: PointerEvent) => {
    const session = capsuleDragSession.current
    if (!session || event.pointerId !== session.pointerId) return
    const deltaX = event.clientX - session.startX
    const deltaY = event.clientY - session.startY
    if (!session.dragging) {
      if (Math.hypot(deltaX, deltaY) < CAPSULE_DRAG_THRESHOLD) return
      session.dragging = true
      setCapsuleDragging(true)
    }
    event.preventDefault()
    // right/bottom 量的是到视口右缘、下缘的距离，指针往右下走时它们变小。
    // 拖动中按普通位置夹取，贴边只在松手时生效，否则胶囊一碰到边就被钉住。
    const viewport = getCapsuleViewport()
    const right = session.startAnchor.right - deltaX
    session.dock = resolveCapsuleDock({ right, width: session.startAnchor.width }, viewport, session.startAnchor.dock)
    capsuleAnchorStore.set(clampCapsuleAnchor({
      ...session.startAnchor,
      dock: undefined,
      right,
      bottom: session.startAnchor.bottom - deltaY,
    }, viewport))
  })

  const stopCapsuleDrag = React.useRef(() => {
    const session = capsuleDragSession.current
    if (!session) return
    window.removeEventListener('pointermove', handleCapsuleDragMove.current)
    window.removeEventListener('pointerup', stopCapsuleDrag.current)
    window.removeEventListener('pointercancel', stopCapsuleDrag.current)
    capsuleDragSession.current = undefined
    setCapsuleDragging(false)
    if (!session.dragging) return
    capsuleHost.current?.addEventListener('click', blockCapsuleClick.current, true)
    const dragged = capsuleAnchorStore.get()
    if (!dragged) return
    const anchor = clampCapsuleAnchor({ ...dragged, dock: session.dock }, getCapsuleViewport())
    capsuleAnchorStore.set(anchor)
    // 松手即收起：指针此时仍压在胶囊上，等它离开会让贴边看起来没有生效。
    if (anchor.dock) {
      clearTimeout(dockHideTimer.current)
      setDockHovered(false)
    }
    // 只存位置与贴边：宽高每次重新量，存下来会在机器人数量变化后按过期尺寸算夹取边界。
    writeStored(CAPSULE_ANCHOR_STORAGE_KEY, anchor.dock
      ? { right: anchor.right, bottom: anchor.bottom, dock: anchor.dock }
      : { right: anchor.right, bottom: anchor.bottom })
  })

  const startCapsuleDrag = (event: React.PointerEvent) => {
    if (event.button !== 0 || capsuleDragSession.current) return
    const startAnchor = measureCapsuleAnchor()
    if (!startAnchor) return
    // 上一次拖动的点击拦截若没被消费（松手落在胶囊外时不会派发 click），先撤掉，否则它会吃掉这一次真正的点击。
    releaseCapsuleClickSuppression()
    // 不调用 preventDefault：pointerdown 的默认行为里包含把 <button> 聚焦，头像栈的折叠状态机依赖这次聚焦。
    capsuleDragSession.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startAnchor,
      dragging: false,
    }
    window.addEventListener('pointermove', handleCapsuleDragMove.current)
    window.addEventListener('pointerup', stopCapsuleDrag.current)
    window.addEventListener('pointercancel', stopCapsuleDrag.current)
  }

  // 摘要文字区没有按钮，按下时取消默认行为只会阻止文本选择；否则拖过页面会选中沿途文字。
  const startCapsuleBodyDrag = (event: React.PointerEvent) => {
    if (event.button === 0) event.preventDefault()
    startCapsuleDrag(event)
  }

  // 机器人头像是 <img>，浏览器给图片的默认行为是原生拖放；dragstart 会先于我们的位移成立并派发
  // pointercancel 收走指针序列，表现为「拖不动」。整枚胶囊没有需要原生拖放的内容，无条件取消。
  const blockCapsuleNativeDrag = (event: React.DragEvent) => event.preventDefault()

  const hideAvatarGuide = () => setAvatarGuideVisible(false)

  const showAvatarGuide = (remember = false) => {
    if (webQQOpenStore.get()) return
    if (remember) writeStored(AVATAR_GUIDE_STORAGE_KEY, 'seen')
    // 已经在显示时再点：节点不会重新挂载，波纹时间轴必须手动从头跑，否则这一次点击可能正好落在两圈波纹之间。
    if (avatarGuideVisible) avatarGuideMotion.restart()
    setAvatarGuideVisible(true)
    setAvatarGuideRun((run) => run + 1)
  }

  // 收起计时跟随引导状态，而不是挂在只执行一次的挂载 effect 里：StrictMode 与 HMR 会先卸载再挂载，
  // 卸载清掉计时后，再次挂载读到「已看过」不会重新显示，引导就永远停在可见状态，贴边胶囊也收不回去。
  React.useEffect(() => {
    if (!avatarGuideVisible) return
    const timer = setTimeout(() => setAvatarGuideVisible(false), 3600)
    return () => clearTimeout(timer)
  }, [avatarGuideVisible, avatarGuideRun])

  const toggleWebQQ = () => {
    const next = !webQQOpenStore.get()
    webQQOpenStore.set(next)
    if (!next) return
    writeStored(AVATAR_GUIDE_STORAGE_KEY, 'seen')
    hideAvatarGuide()
  }

  const selectBot = async (selfId: string) => {
    if (selfId === activeBotSelfId) {
      toggleWebQQ()
      return
    }
    try {
      const botState = await selectWebQQBot(selfId)
      const animation = scheduleBotStackAnimation()
      // 挂起折叠后再重排：移动这枚（Chrome 已聚焦的）按钮触发的伪 focusout 不会打断切换 FLIP。
      suppressStackCollapse.current = true
      clearTimeout(suppressStackCollapseTimer.current)
      runtimeBots.set(botState.bots)
      selectedBotSelfIdStore.set(botState.selectedSelfId || selfId)
      webQQOpenStore.set(true)
      writeStored(AVATAR_GUIDE_STORAGE_KEY, 'seen')
      hideAvatarGuide()
      await animation
      // 切换 FLIP 跑完再解除挂起，并按 document.activeElement 的真实归属重新判定，
      // 避免键盘切换后焦点仍在胶囊内却误折叠。
      suppressStackCollapseTimer.current = setTimeout(() => {
        suppressStackCollapse.current = false
        suppressStackCollapseTimer.current = undefined
        botStackFocused.current = !!capsuleHost.current?.contains(document.activeElement)
        syncBotStackExpanded()
      }, 280)
    } catch {
      suppressStackCollapse.current = false
    }
  }

  // 观察窗打开时，点在小胶囊与 WebQQ 交互面之外就关闭。菜单、弹窗与二级页经 Portal 挂到 body，
  // DOM 上不属于胶囊，但仍是 WebQQ 交互面。
  React.useEffect(() => {
    const closeWebQQOnOutsideClick = (event: PointerEvent) => {
      if (!webQQOpenStore.get()) return
      const target = event.target
      if (target instanceof Node && capsuleHost.current?.contains(target)) return
      if (target instanceof Element && target.closest([
        '.webqq-context-menu-content',
        '.onebot-webqq-webqq__portal-page',
        '.onebot-webqq-webqq__notice-menu',
        '.webqq-dialog-overlay',
        '.webqq-dialog-content',
        '.onebot-webqq-webqq__message-search-date-popover',
        '.onebot-webqq-webqq__scrollbar-overlay',
        '[data-onebot-webqq-surface]',
      ].join(', '))) return
      webQQOpenStore.set(false)
    }
    document.addEventListener('pointerdown', closeWebQQOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeWebQQOnOutsideClick)
  }, [])

  React.useEffect(() => {
    // 视口变小会把已经贴边的入口挤出屏幕：只夹取运行时锚点、不写回存储，窗口拉回来后重载，用户原来选的位置还在。
    const clampCapsuleAnchorToViewport = () => {
      const anchor = capsuleAnchorStore.get()
      if (!anchor) return
      const host = capsuleHost.current?.getBoundingClientRect()
      capsuleAnchorStore.set(clampCapsuleAnchor({
        ...anchor,
        width: host?.width ?? anchor.width,
        height: host?.height ?? anchor.height,
      }, getCapsuleViewport()))
    }
    window.addEventListener('resize', updateCapsuleTooltipPosition)
    window.addEventListener('resize', clampCapsuleAnchorToViewport)
    if (readStored(AVATAR_GUIDE_STORAGE_KEY) !== 'seen') showAvatarGuide(true)
    const dragStop = stopCapsuleDrag.current
    const clickBlock = blockCapsuleClick.current
    return () => {
      window.removeEventListener('resize', updateCapsuleTooltipPosition)
      window.removeEventListener('resize', clampCapsuleAnchorToViewport)
      dragStop()
      capsuleHost.current?.removeEventListener('click', clickBlock, true)
      botStackLayout.current?.revert()
      botStackLayout.current = undefined
      clearTimeout(botStackOverflowMotionTimer.current)
      clearTimeout(suppressStackCollapseTimer.current)
      clearTimeout(dockHideTimer.current)
      avatarGuideMotion.destroy()
    }
  }, [])

  // 文字溢出随标题、活动文案与头像栈展开变化重新判定。
  React.useLayoutEffect(() => {
    if (!shouldShowCapsule) return
    refreshCapsuleTextOverflow()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(refreshCapsuleTextOverflow)
    for (const element of [titleRef.current, activityRef.current, activityUserRef.current]) {
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [shouldShowCapsule, displayBotName, displayActivityText, conversationUserName, botStackExpanded, refreshCapsuleTextOverflow])

  // 隐藏页期间没有渲染 host，量不到锚点；胶囊每次重新出现都补一次恢复。已经有锚点就不再读存储：
  // 此时运行时值可能刚被视口夹取过，回填旧值会把胶囊弹回屏幕外。
  React.useLayoutEffect(() => {
    if (!shouldShowCapsule || capsuleAnchorStore.get()) return
    const stored = normalizeCapsuleAnchorPosition(readStored(CAPSULE_ANCHOR_STORAGE_KEY))
    const measured = measureCapsuleAnchor()
    if (!stored || !measured) return
    capsuleAnchorStore.set(clampCapsuleAnchor({ ...measured, ...stored }, getCapsuleViewport()))
  }, [shouldShowCapsule])

  React.useEffect(() => {
    if (!displayBotProfile?.name) return
    const profile = { name: displayBotProfile.name, avatar: displayBotProfile.avatar || '' }
    setCachedBotProfile(profile)
    writeStored(BOT_PROFILE_STORAGE_KEY, profile)
  }, [displayBotProfile?.name, displayBotProfile?.avatar])

  React.useEffect(() => {
    if (!config.debug) return
    console.debug('[onebot-webqq][bot-status-debug] capsule-display', {
      selectedBotSelfId,
      displayBot: displayBotProfile ? { selfId: displayBotProfile.selfId, status: displayBotProfile.status } : undefined,
      statusClass,
      availableBots: availableBots.map((bot) => ({ selfId: bot.selfId, status: bot.status })),
    })
  }, [config.debug, displayBotProfile, availableBots, statusClass, selectedBotSelfId])

  if (!shouldShowCapsule) return null

  const renderAvatarImage = (bot: { avatar?: string } & Pick<OneBotRobotProfile, 'name' | 'selfId'>) => bot.avatar
    ? <img src={bot.avatar} alt={getBotName(bot)} />
    : <BotAvatarIcon />

  return (
    <div
      ref={capsuleHost}
      className={[
        'onebot-webqq-host',
        capsuleDragging ? 'is-dragging' : '',
        capsuleDock ? `is-docked-${capsuleDock}` : '',
        dockHidden ? 'is-dock-hidden' : '',
        dockHidden && dockSettled ? 'is-dock-settled' : '',
      ].filter(Boolean).join(' ')}
      style={capsuleHostStyle}
      onPointerEnter={() => {
        clearTimeout(dockHideTimer.current)
        setDockHovered(true)
      }}
      onPointerLeave={() => {
        clearTimeout(dockHideTimer.current)
        dockHideTimer.current = setTimeout(() => setDockHovered(false), CAPSULE_DOCK_HIDE_DELAY)
      }}
      // 只认键盘焦点：鼠标点击头像也会聚焦按钮，按这种焦点保持展开会让胶囊点过后收不回去。
      onFocus={(event) => setDockFocused(event.target.matches(':focus-visible'))}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget
        if (!(nextTarget instanceof Node && event.currentTarget.contains(nextTarget))) setDockFocused(false)
      }}
    >
      {/* 胶囊位移层：Anime.js FLIP 会给 layout root 加 transition: none !important 并接管其子节点 translate，
          展开补偿与贴边位移若放在 root 上，悬停把手时胶囊会瞬间跳出或与头像栈错位。 */}
      <div ref={dockSlideRef} className="onebot-webqq-dock-slide">
        <div ref={capsuleLayoutRef} className="onebot-webqq-layout-root" onPointerDown={startCapsuleDrag} onDragStart={blockCapsuleNativeDrag}>
          <div
            className={[
              'onebot-webqq',
              config.enableCapsuleFrostedGlass ? 'is-frosted' : 'is-plain',
              `is-color-${resolvedColorMode}`,
              botStackVisualExpanded ? 'is-bot-stack-expanded' : '',
            ].filter(Boolean).join(' ')}
            style={capsuleStyle}
            aria-live="polite"
          >
            <div
              className={['onebot-webqq__avatar-capsule', hasMultipleBots ? 'has-bot-stack' : '', botStackVisualExpanded ? 'is-expanded' : ''].filter(Boolean).join(' ')}
              style={avatarCapsuleStyle}
              onPointerEnter={() => {
                botStackHovered.current = true
                syncBotStackExpanded()
              }}
              onPointerLeave={() => {
                botStackHovered.current = false
                syncBotStackExpanded()
              }}
              onFocus={() => {
                botStackFocused.current = true
                syncBotStackExpanded()
              }}
              onBlur={(event) => {
                // 焦点仍落在胶囊内部（Tab 切换头像）时不算离开。
                const nextTarget = event.relatedTarget
                botStackFocused.current = nextTarget instanceof Node && event.currentTarget.contains(nextTarget)
                syncBotStackExpanded()
              }}
            >
              {hasMultipleBots ? (
                <div
                  className={[
                    'onebot-webqq__bot-stack',
                    botStackVisualExpanded ? 'is-expanded' : '',
                    botStackOverflowMotion === 'expanding' ? 'is-overflow-expanding' : '',
                    botStackOverflowMotion === 'collapsing' ? 'is-overflow-collapsing' : '',
                  ].filter(Boolean).join(' ')}
                  style={botStackStyle}
                >
                  {botStackBots.map((bot, index) => {
                    const active = bot.selfId === activeBotSelfId
                    const hidden = isBotCollapsedHidden(index)
                    return (
                      <button
                        key={bot.selfId}
                        className={[
                          'onebot-webqq__bot-switch',
                          active ? 'is-active' : '',
                          index > 0 ? 'is-overlapped' : '',
                          isBotCollapsedExtra(index) ? 'is-collapsed-extra' : '',
                        ].filter(Boolean).join(' ')}
                        type="button"
                        aria-label={active ? t('capsule.openBot', { name: getBotName(bot) }) : t('capsule.switchBot', { name: getBotName(bot) })}
                        aria-pressed={active}
                        aria-hidden={hidden ? 'true' : undefined}
                        tabIndex={hidden ? -1 : undefined}
                        style={getBotSwitchStyle(index)}
                        onClick={(event) => {
                          event.stopPropagation()
                          void selectBot(bot.selfId)
                        }}
                      >
                        <span className="onebot-webqq__avatar">
                          {renderAvatarImage(bot)}
                          {active ? <span className={['onebot-webqq__status', getBotStatusClass(bot)].join(' ')}></span> : null}
                          {showUnread && active ? <span className="onebot-webqq__avatar-unread">{capsuleUnreadText}</span> : null}
                          {active ? <AvatarGuide visible={avatarGuideVisible && !webQQOpen} motion={avatarGuideMotion} /> : null}
                        </span>
                      </button>
                    )
                  })}
                  {collapsedBotOverflowCount ? (
                    <span className="onebot-webqq__bot-overflow" style={botOverflowStyle} aria-hidden="true">
                      {botOverflowPreview ? (
                        <span className="onebot-webqq__bot-overflow-avatar">{renderAvatarImage(botOverflowPreview)}</span>
                      ) : null}
                      <span className="onebot-webqq__bot-overflow-label">
                        <span className="onebot-webqq__bot-overflow-plus">+</span>
                        <span className="onebot-webqq__bot-overflow-count">{collapsedBotOverflowCount}</span>
                      </span>
                    </span>
                  ) : null}
                </div>
              ) : (
                <button
                  className="onebot-webqq__avatar-button"
                  type="button"
                  aria-label={capsuleButtonLabel}
                  aria-expanded={webQQOpen}
                  onClick={toggleWebQQ}
                >
                  <span className="onebot-webqq__avatar">
                    {displayBotAvatar ? <img src={displayBotAvatar} alt={displayBotName} /> : <BotAvatarIcon />}
                    <span className={['onebot-webqq__status', statusClass].join(' ')}></span>
                    {showUnread ? <span className="onebot-webqq__avatar-unread">{capsuleUnreadText}</span> : null}
                    <AvatarGuide visible={avatarGuideVisible && !webQQOpen} motion={avatarGuideMotion} />
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div
        className={['onebot-webqq__body', `is-color-${resolvedColorMode}`].join(' ')}
        onPointerDown={startCapsuleBodyDrag}
        onDragStart={blockCapsuleNativeDrag}
        onClick={() => showAvatarGuide()}
      >
        <div className="onebot-webqq__title-line">
          <div
            ref={titleRef}
            className="onebot-webqq__title"
            onPointerEnter={() => showCapsuleTextTooltip('title')}
            onPointerLeave={() => setTooltipTarget(undefined)}
          >
            {displayBotName}
          </div>
          {titleStatusText ? <span className="onebot-webqq__title-status is-thinking">{titleStatusText}</span> : null}
        </div>
        <div className="onebot-webqq__meta">
          {displayActivityText ? (
            <span
              ref={activityRef}
              className={['onebot-webqq__activity', conversationUserName ? 'is-conversation' : ''].filter(Boolean).join(' ')}
              onPointerEnter={() => showCapsuleTextTooltip('activity')}
              onPointerLeave={() => setTooltipTarget(undefined)}
            >
              {conversationUserName ? (
                <>
                  <span className="onebot-webqq__activity-prefix">{t('capsule.talkingPrefix')}</span>
                  <span ref={activityUserRef} className="onebot-webqq__activity-user">{conversationUserName}</span>
                  <span className="onebot-webqq__activity-suffix">{t('capsule.talkingSuffix')}</span>
                </>
              ) : displayActivityText}
            </span>
          ) : null}
        </div>
        <CssTransition name="onebot-webqq-tooltip" show={!!capsuleTooltipText}>
          <div
            ref={tooltipRef}
            className="onebot-webqq__tooltip"
            style={{ '--onebot-webqq-tooltip-left': `${tooltipLeft}px` } as React.CSSProperties}
            role="tooltip"
          >
            <span className="onebot-webqq__tooltip-content">{capsuleTooltipText}</span>
          </div>
        </CssTransition>
      </div>
      {/* 贴边把手的未读红点按屏幕边缘固定定位，不放进胶囊：头像栈 FLIP 期间胶囊内的绝对定位会停在旧宽度上，
          收起时红点会和胶囊错开。host 不带位移，fixed 直接相对视口。 */}
      {capsuleDock && showUnread
        ? <span className={['onebot-webqq__dock-unread', `is-color-${resolvedColorMode}`].join(' ')} aria-hidden="true"></span>
        : null}
      {props.children}
    </div>
  )
}
