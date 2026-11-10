/**
 * 观察窗跟随入口锚点时的落位判定。
 *
 * 提出来的是判定而不是 DOM 机械动作：观察窗最小 640×420、默认还按 1040/656 的比例撑开，入口一旦被
 * 拖到视口上半部分，「贴着入口上沿打开」就会把窗体顶出视口。改坏了不会报错，只会表现为观察窗缺了
 * 一角或整块跑到屏幕外。元素测量与样式写入留在 WebQQObserver.vue。
 */

/** 入口在视口右下角坐标系里的位置与高度。宽度与落位无关：观察窗只按入口的右缘对齐。 */
export interface WebQQPanelEntry {
  readonly right: number
  readonly bottom: number
  readonly height: number
}

export interface WebQQPanelSize {
  readonly width: number
  readonly height: number
}

export interface WebQQPanelViewport {
  readonly width: number
  readonly height: number
}

export interface WebQQPanelAnchor {
  readonly right: number
  readonly bottom: number
}

/** 观察窗与入口之间的间隙：与 webqq-shell.scss 默认的 `bottom: 116px` = 锚点 56px + 入口 50px + 10px 同源。 */
export const WEBQQ_PANEL_ENTRY_GAP = 10

/** 观察窗与视口左右缘的最小间距：与默认宽度 `min(100vw - 32px, …)` 配 `right: 24px` 时的左缘留白同源。 */
export const WEBQQ_PANEL_VIEWPORT_MARGIN_X = 8

/** 观察窗与视口上下缘的最小间距：与缩放上限里的 webQQResizeViewportHeightGap 同源。 */
export const WEBQQ_PANEL_VIEWPORT_MARGIN_Y = 6

/**
 * 由入口锚点推出观察窗自己的 right/bottom。
 *
 * 竖直方向的三段取舍就是这个函数的全部意义：
 *
 * 1. 入口上方放得下就贴着入口上沿开，这是默认形态，与没拖动过时的 CSS 落位一致。
 * 2. 上方放不下就翻到入口下方，而不是直接夹取——夹取会把窗体压在入口上，用户会被自己的面板挡住入口。
 * 3. 上下都放不下（视口比窗体还矮）时才夹取，并且保下缘可见、让顶部溢出：输入区和消息尾部在下缘。
 *
 * 水平方向只有一段：右缘跟随入口，但不能把左缘推出视口；窗体比视口还宽时保右缘，与竖直方向同理。
 */
export function resolveWebQQPanelAnchor(input: {
  entry: WebQQPanelEntry
  panel: WebQQPanelSize
  viewport: WebQQPanelViewport
}): WebQQPanelAnchor {
  const { entry, panel, viewport } = input
  const maxRight = viewport.width - panel.width - WEBQQ_PANEL_VIEWPORT_MARGIN_X
  const right = Math.round(Math.max(WEBQQ_PANEL_VIEWPORT_MARGIN_X, Math.min(entry.right, maxRight)))
  const maxBottom = viewport.height - panel.height - WEBQQ_PANEL_VIEWPORT_MARGIN_Y
  const aboveBottom = entry.bottom + entry.height + WEBQQ_PANEL_ENTRY_GAP
  if (aboveBottom <= maxBottom) return { right, bottom: Math.round(aboveBottom) }
  const belowBottom = entry.bottom - WEBQQ_PANEL_ENTRY_GAP - panel.height
  if (belowBottom >= WEBQQ_PANEL_VIEWPORT_MARGIN_Y) return { right, bottom: Math.round(belowBottom) }
  return { right, bottom: Math.round(Math.max(WEBQQ_PANEL_VIEWPORT_MARGIN_Y, maxBottom)) }
}
