export interface FloatingPanelAnchor {
  x: number
  y: number
}

export interface FloatingPanelViewport {
  width: number
  height: number
}

const panelGap = 8
const viewportPadding = 12
let lastAnchor: FloatingPanelAnchor = { x: viewportPadding, y: viewportPadding }

export function getFloatingPanelRectAnchor(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): FloatingPanelAnchor {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

export function rememberFloatingPanelAnchor(event: MouseEvent): void {
  if (event.clientX || event.clientY) {
    lastAnchor = { x: event.clientX, y: event.clientY }
    return
  }
  // 键盘激活按钮产生的 click 坐标通常是 (0, 0)；改用控件中心，避免浮层跳到视口左上角。
  if (typeof Element === 'undefined' || !(event.target instanceof Element)) return
  const target = event.target.closest('button, [role="button"], a')
  if (!target) return
  lastAnchor = getFloatingPanelRectAnchor(target.getBoundingClientRect())
}

export function getFloatingPanelPosition(
  anchor: FloatingPanelAnchor,
  viewport: FloatingPanelViewport,
  panel: { width: number, height: number },
): FloatingPanelAnchor {
  const width = Math.min(panel.width, Math.max(0, viewport.width - viewportPadding * 2))
  const height = Math.min(panel.height, Math.max(0, viewport.height - viewportPadding * 2))
  return {
    x: Math.max(viewportPadding, Math.min(anchor.x + panelGap, viewport.width - width - viewportPadding)),
    y: Math.max(viewportPadding, Math.min(anchor.y + panelGap, viewport.height - height - viewportPadding)),
  }
}

export function getFloatingPanelStyle(panel: { width?: number, height: number }): Record<string, string> {
  const position = getFloatingPanelPosition(lastAnchor, {
    width: window.innerWidth,
    height: window.innerHeight,
  }, {
    width: panel.width ?? 380,
    height: panel.height,
  })
  return {
    left: `${position.x}px`,
    top: `${position.y}px`,
  }
}

export function clampFloatingPanelPosition(
  position: FloatingPanelAnchor,
  viewport: FloatingPanelViewport,
  panel: { width: number, height: number },
): FloatingPanelAnchor {
  return {
    x: Math.max(viewportPadding, Math.min(position.x, viewport.width - panel.width - viewportPadding)),
    y: Math.max(viewportPadding, Math.min(position.y, viewport.height - panel.height - viewportPadding)),
  }
}

export function isFloatingPanelInteractiveTarget(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && target instanceof Element && !!target.closest('button, input, textarea, select, [role="button"], a')
}

/**
 * 门户页（资料卡、表情选择）的面板级 Escape。
 * 这两个面板的根节点没有 tabindex，焦点未必落在面板内，`@keydown.esc` 挂在根节点上收不到事件；
 * 它们的点外面关闭已经走 document 监听，Escape 走同一条路，注册与摘除都跟着现有的挂载钩子。
 * `dismiss` 是「退掉当前最上层」而不一定是关面板：面板自己有内部层时，先退内部层。
 */
export function createFloatingPanelEscapeHandler(options: {
  isOpen: () => boolean
  dismiss: () => void
}): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    if (!options.isOpen() || event.key !== 'Escape') return
    // 门户页此刻是最上层：吃掉这一下，否则同一次 Escape 会继续冒到 window，
    // 顺带触发观察窗那条分支（查找 → 转发目标 → 多选模式 → 回复目标）。
    event.preventDefault()
    event.stopPropagation()
    options.dismiss()
  }
}
