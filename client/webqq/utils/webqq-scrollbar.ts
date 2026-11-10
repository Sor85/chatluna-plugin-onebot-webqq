import * as React from 'react'
import { computeVisibleScrollbarRect } from './webqq-scrollbar-track-bounds'
import {
  applyScrollbarCue,
  createScrollbarVisibility,
  isScrollbarThumbWide,
  type ScrollbarCue,
  type ScrollbarVisibility,
} from './webqq-scrollbar-visibility'

const edgeGap = 8
const overlayInset = 0
const overlayWidth = 10
const minThumbHeight = 28
/**
 * 指针或滚动停下多久之后收起轨道。取 1.5 秒这一档常见的浮层滚动条自动隐藏时长：短于 1 秒会在
 * 用户还在读位置时就抽走，长过 2 秒又会让轨道显得赖着不走。
 */
const hideDelay = 1500

interface WebQQScrollbarState {
  element: HTMLElement
  overlay: HTMLDivElement
  thumb: HTMLDivElement
  resizeObserver?: ResizeObserver
  mutationObserver?: MutationObserver
  frame: number
  hideTimer: number
  visibility: ScrollbarVisibility
  dragStartY: number
  dragStartScrollTop: number
  trackHeight: number
  thumbHeight: number
  cleanup: Array<() => void>
}

const states = new WeakMap<HTMLElement, WebQQScrollbarState>()

export interface WebQQScrollbarOptions {
  hideOnNarrow?: boolean
  tone?: 'accent'
  zIndex?: number
}

function addListener(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options)
  return () => target.removeEventListener(type, listener, options)
}

function clearHideTimer(state: WebQQScrollbarState) {
  if (!state.hideTimer) return
  window.clearTimeout(state.hideTimer)
  state.hideTimer = 0
}

/** 只把判定结果写进 DOM：可见性与滑块加宽态，不碰倒计时。 */
function writeScrollbarClasses(state: WebQQScrollbarState) {
  state.overlay.classList.toggle('is-visible', state.visibility.revealed)
  state.overlay.classList.toggle('is-wide', isScrollbarThumbWide(state.visibility))
}

/**
 * 写 DOM 并把倒计时对齐到判定：需要倒计时就重排，不需要就清掉。
 *
 * 每次都重排而不是「已有就不动」：指针在滚动区里连续移动时每一次都要把 hideDelay 推后，否则轨道会
 * 在指针还在动的时候到点收起，紧接着又被下一次移动唤醒，表现为持续闪烁。也正因为重排会推后收起
 * 时刻，只有真正的显隐线索才能走这里——组件重渲染那种与指针无关的时机必须只写类名。
 */
function syncScrollbar(state: WebQQScrollbarState) {
  writeScrollbarClasses(state)
  clearHideTimer(state)
  if (!state.visibility.hideScheduled) return
  state.hideTimer = window.setTimeout(() => {
    state.hideTimer = 0
    cue(state, 'hide-timeout')
  }, hideDelay)
}

/** 显隐只从这里改：判定给出下一个状态，DOM 与计时器跟着同步，几何顺手校正。 */
function cue(state: WebQQScrollbarState, name: ScrollbarCue) {
  state.visibility = applyScrollbarCue(state.visibility, name)
  syncScrollbar(state)
  scheduleUpdate(state)
}

function stopEvent(event: Event) {
  event.stopPropagation()
}

function readAccentColor(element: HTMLElement) {
  const root = element.closest<HTMLElement>('.onebot-webqq-webqq') || element
  return getComputedStyle(root).getPropertyValue('--onebot-webqq-webqq-accent').trim()
}

function getVisibleScrollbarRect(element: HTMLElement) {
  const shellElement = element.closest<HTMLElement>('.onebot-webqq-webqq')
  return computeVisibleScrollbarRect(element, shellElement ?? undefined)
}

function updateScrollbar(state: WebQQScrollbarState) {
  state.frame = 0
  const { element, overlay } = state
  const rect = getVisibleScrollbarRect(element)
  const trackHeight = Math.max(0, rect.height - edgeGap * 2)
  const maxScrollTop = element.scrollHeight - element.clientHeight
  const isUsable = element.isConnected && rect.width > 0 && trackHeight > 0 && maxScrollTop > 1

  if (!isUsable) {
    // 只在确实还留着可见状态或倒计时时发线索：cue 会再排一帧校正，无条件发会让两者互相唤醒。
    if (state.visibility.revealed || state.visibility.hideScheduled) cue(state, 'unusable')
    return
  }

  const accent = readAccentColor(element)
  if (accent) overlay.style.setProperty('--onebot-webqq-webqq-accent', accent)

  state.trackHeight = trackHeight
  state.thumbHeight = Math.max(minThumbHeight, trackHeight * element.clientHeight / element.scrollHeight)
  const maxThumbTop = Math.max(0, trackHeight - state.thumbHeight)
  const thumbTop = maxScrollTop ? element.scrollTop / maxScrollTop * maxThumbTop : 0

  overlay.style.left = `${Math.round(rect.right - overlayWidth - overlayInset)}px`
  overlay.style.top = `${Math.round(rect.top + edgeGap)}px`
  overlay.style.height = `${Math.round(trackHeight)}px`
  overlay.style.setProperty('--onebot-webqq-webqq-scrollbar-thumb-top', `${thumbTop}px`)
  overlay.style.setProperty('--onebot-webqq-webqq-scrollbar-thumb-height', `${state.thumbHeight}px`)
}

function scheduleUpdate(state: WebQQScrollbarState) {
  if (state.frame) return
  state.frame = window.requestAnimationFrame(() => updateScrollbar(state))
}

function updateDraggedScrollTop(state: WebQQScrollbarState, clientY: number) {
  const maxScrollTop = state.element.scrollHeight - state.element.clientHeight
  const maxThumbTop = Math.max(1, state.trackHeight - state.thumbHeight)
  const delta = clientY - state.dragStartY
  state.element.scrollTop = state.dragStartScrollTop + delta / maxThumbTop * maxScrollTop
}

function stopDragging(state: WebQQScrollbarState) {
  state.thumb.classList.remove('is-dragging')
  cue(state, 'drag-end')
}

function createOverlay() {
  const overlay = document.createElement('div')
  overlay.className = 'onebot-webqq-webqq__scrollbar-overlay'
  const thumb = document.createElement('div')
  thumb.className = 'onebot-webqq-webqq__scrollbar-thumb'
  overlay.appendChild(thumb)
  document.body.appendChild(overlay)
  return { overlay, thumb }
}

function applyScrollbarOptions(
  state: WebQQScrollbarState,
  options: WebQQScrollbarOptions | undefined,
) {
  const { overlay } = state
  overlay.classList.toggle('is-hidden-on-narrow', Boolean(options?.hideOnNarrow))
  overlay.classList.toggle('is-accent', options?.tone === 'accent')
  overlay.style.zIndex = options?.zIndex == null ? '' : String(options.zIndex)
  // 这里的时机是组件重渲染，推后收起时刻会让轨道在消息流不断刷新的会话里一直赖着，因此只重写类名。
  writeScrollbarClasses(state)
}

/**
 * 给实际可滚动的元素挂上自绘滚动条：轨道是挂到 body 的独立浮层，原生滚动条由
 * `[data-onebot-webqq-scrollbar=true]` 规则隐藏。返回更新选项与卸载两个操作。
 */
export function attachWebQQScrollbar(element: HTMLElement, options?: WebQQScrollbarOptions) {
  const { overlay, thumb } = createOverlay()
  const state: WebQQScrollbarState = {
    element,
    overlay,
    thumb,
    frame: 0,
    hideTimer: 0,
    visibility: createScrollbarVisibility(),
    dragStartY: 0,
    dragStartScrollTop: 0,
    trackHeight: 0,
    thumbHeight: 0,
    cleanup: [],
  }

  states.set(element, state)
  element.dataset.onebotWebqqScrollbar = 'true'
  applyScrollbarOptions(state, options)

  const enter = () => cue(state, 'pointer-enter-area')
  const leave = () => cue(state, 'pointer-leave-area')
  const move = () => cue(state, 'pointer-move-area')
  const focusIn = () => cue(state, 'focus-in')
  const focusOut = () => cue(state, 'focus-out')
  const scroll = () => cue(state, 'scroll')
  const update = () => scheduleUpdate(state)
  const pointerDown = (event: Event) => {
    if (!(event instanceof PointerEvent)) return
    event.preventDefault()
    event.stopPropagation()
    state.dragStartY = event.clientY
    state.dragStartScrollTop = element.scrollTop
    thumb.classList.add('is-dragging')
    cue(state, 'drag-start')
  }
  const pointerMove = (event: Event) => {
    if (!state.visibility.dragging) return
    if (!(event instanceof PointerEvent)) return
    event.preventDefault()
    updateDraggedScrollTop(state, event.clientY)
    scheduleUpdate(state)
  }
  const pointerUp = () => {
    if (!state.visibility.dragging) return
    stopDragging(state)
  }
  const thumbEnter = () => cue(state, 'pointer-enter-thumb')
  const thumbLeave = () => cue(state, 'pointer-leave-thumb')

  state.cleanup.push(
    addListener(element, 'mouseenter', enter),
    addListener(element, 'mouseleave', leave),
    addListener(element, 'mousemove', move, { passive: true }),
    addListener(element, 'focusin', focusIn),
    addListener(element, 'focusout', focusOut),
    addListener(element, 'scroll', scroll, { passive: true }),
    addListener(window, 'resize', update),
    addListener(window, 'scroll', update, { capture: true, passive: true }),
    addListener(thumb, 'pointerdown', pointerDown),
    addListener(thumb, 'click', stopEvent),
    addListener(thumb, 'mouseenter', thumbEnter),
    addListener(thumb, 'mouseleave', thumbLeave),
    addListener(document, 'pointermove', pointerMove),
    addListener(document, 'pointerup', pointerUp),
    addListener(document, 'pointercancel', pointerUp),
  )

  if (typeof ResizeObserver !== 'undefined') {
    state.resizeObserver = new ResizeObserver(update)
    state.resizeObserver.observe(element)
  }

  if (typeof MutationObserver !== 'undefined') {
    state.mutationObserver = new MutationObserver(update)
    state.mutationObserver.observe(element, { childList: true, subtree: true, characterData: true })
  }

  scheduleUpdate(state)

  return {
    update(next?: WebQQScrollbarOptions) {
      const state = states.get(element)
      if (!state) return
      applyScrollbarOptions(state, next)
      scheduleUpdate(state)
    },
    dispose() {
      const state = states.get(element)
      if (!state) return
      states.delete(element)
      delete element.dataset.onebotWebqqScrollbar
      clearHideTimer(state)
      if (state.frame) window.cancelAnimationFrame(state.frame)
      state.resizeObserver?.disconnect()
      state.mutationObserver?.disconnect()
      for (const cleanup of state.cleanup) cleanup()
      state.overlay.remove()
    },
  }
}

/**
 * React 用法：返回挂到可滚动元素上的 ref 回调。元素换了就把滚动条搬过去；每次渲染都把选项同步一次，
 * 对应原指令的 updated 钩子（只重写类名，不推后收起时刻）。
 */
export function useWebQQScrollbar<T extends HTMLElement>(options?: WebQQScrollbarOptions) {
  const handle = React.useRef<ReturnType<typeof attachWebQQScrollbar>>(undefined)
  const latest = React.useRef(options)
  latest.current = options
  React.useLayoutEffect(() => {
    handle.current?.update(latest.current)
  })
  return React.useCallback((element: T | null) => {
    handle.current?.dispose()
    handle.current = element ? attachWebQQScrollbar(element, latest.current) : undefined
  }, [])
}
