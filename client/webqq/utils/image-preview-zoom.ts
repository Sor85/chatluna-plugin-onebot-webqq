
/**
 * 图片放大层的滚轮缩放与拖动平移。
 *
 * 判定住在这里、DOM 机械动作留在视图。四处判定全靠人在浏览器里滚着试才能发现改坏：
 * 缩放要以指针为锚点（否则放大后视野跳到图片中心，指着的地方跑掉）、倍率要夹在上下界内
 * （否则滚到 0 倍图片消失、滚到几百倍变成一片马赛克）、位移要按当前倍率夹住
 * （否则能把图片拖出视野外，留下一片空遮罩）、以及拖动之后要吃掉紧随的那一次 click
 * （否则松手时遮罩的 `click.self` 判定成立，拖一下图片就把预览关掉了）。
 *
 * 倍率 1 是 CSS 已经安排好的贴合尺寸（`max-width` / `max-height`，小图按原始尺寸），
 * 因此下界就是 1：向下滚回到贴合即止，不做比贴合更小的缩小——再小只会在遮罩里留下更多空白。
 */
export const IMAGE_PREVIEW_ZOOM_MIN = 1
export const IMAGE_PREVIEW_ZOOM_MAX = 8
/** 每格滚轮的倍率因子。乘法步进让每一格的观感变化一致，加法步进在高倍率下会显得越滚越慢。 */
export const IMAGE_PREVIEW_ZOOM_FACTOR = 1.2
/** 低于这个位移仍算单击：触控板和带手抖的鼠标在按下瞬间几乎总有 1~2 像素漂移。 */
export const IMAGE_PREVIEW_DRAG_THRESHOLD_PX = 3
export const IMAGE_PREVIEW_CLICK_SUPPRESSION_MS = 250

/**
 * 缩放平移要问图片的两件事：它现在占多大（贴合后的尺寸，倍率 1 时的实际渲染尺寸），
 * 以及可视区多大。两者一起决定位移的夹取范围。`DOMRect` 天然满足这个形状。
 */
export interface ImagePreviewMetrics {
  /** 倍率 1 时图片的渲染宽高，也就是 CSS 贴合之后的尺寸。 */
  readonly baseWidth: number
  readonly baseHeight: number
  readonly viewportWidth: number
  readonly viewportHeight: number
}

export interface ImagePreviewWheelInput {
  deltaY: number
  clientX: number
  clientY: number
}

export interface ImagePreviewPointerInput {
  pointerId: number
  button?: number
  clientX: number
  clientY: number
}

/** 指针捕获目标的最小形状；`HTMLElement` 天然满足，测试用内存替身。 */
export interface ImagePreviewCaptureTarget {
  setPointerCapture(pointerId: number): void
  releasePointerCapture(pointerId: number): void
  hasPointerCapture(pointerId: number): boolean
}

export interface ImagePreviewZoomOptions {
  /** 读当前的贴合尺寸与可视区尺寸；图片还没加载完时返回 undefined，此时缩放整体停摆。 */
  metrics: () => ImagePreviewMetrics | undefined
  /** 视图中心的屏幕坐标，锚点补偿以它为原点。图片以中心定位，因此原点就是可视区中心。 */
  center: () => { x: number, y: number } | undefined
  /**
   * 越过拖动阈值后接住指针的元素。
   *
   * 放大后图片的可视范围常常小于拖动幅度，指针一旦移出图片就收不到 pointermove，
   * 表现为「拖到一半松手了似的卡住」。捕获推迟到真的越过阈值再取：
   * 捕获会把 pointerup 连同 click 一起改派到捕获元素上。
   */
  captureTarget?: () => ImagePreviewCaptureTarget | undefined
  /** 倍率、位移或拖动态变化后调用，界面据此重渲染。 */
  onChange?: () => void
  now?: () => number
}

/**
 * 位移的可行范围。
 *
 * 图片按当前倍率放大后比可视区大多少，就允许往两边各拖一半——正好能看到边缘而不过界。
 * 没超出可视区的那个方向锁死在 0（保持居中）：可以自由拖动小图会让它飘在遮罩里，
 * 松手后也没有归位的依据。
 */
export function clampImagePreviewOffset(
  offset: { x: number, y: number },
  scale: number,
  metrics: ImagePreviewMetrics,
): { x: number, y: number } {
  const limitX = Math.max((metrics.baseWidth * scale - metrics.viewportWidth) / 2, 0)
  const limitY = Math.max((metrics.baseHeight * scale - metrics.viewportHeight) / 2, 0)
  // `+ 0` 把 `Math.min/max` 在上界为 0 时产出的 -0 归一化：-0 渲染上无差别，但会让相等断言分叉。
  return {
    x: Math.min(Math.max(offset.x, -limitX), limitX) + 0,
    y: Math.min(Math.max(offset.y, -limitY), limitY) + 0,
  }
}

/** 把倍率夹进上下界。 */
export function clampImagePreviewScale(scale: number): number {
  return Math.min(Math.max(scale, IMAGE_PREVIEW_ZOOM_MIN), IMAGE_PREVIEW_ZOOM_MAX)
}

/** 可观察的值：写入时通知调用方重渲染。替代原来的 Vue ref，字段访问方式（`.value`）保持一致。 */
function observable<T>(initial: T, onChange?: () => void) {
  let current = initial
  return {
    get value() {
      return current
    },
    set value(next: T) {
      current = next
      onChange?.()
    },
  }
}

export function createImagePreviewZoom(options: ImagePreviewZoomOptions) {
  const scale = observable(IMAGE_PREVIEW_ZOOM_MIN, options.onChange)
  const offset = observable({ x: 0, y: 0 }, options.onChange)
  const dragging = observable(false, options.onChange)
  const now = options.now ?? (() => performance.now())
  let drag: { pointerId: number, startX: number, startY: number, originX: number, originY: number, moved: boolean } | undefined
  let suppressClickUntil = 0

  /**
   * 缩放到指定倍率，并让锚点下的那一个像素保持不动。
   *
   * 推导：锚点相对视图中心的位移是 d，缩放前它在图片内的坐标是 `(d - offset) / scale`。
   * 要它缩放后仍落在 d 上，新位移就是 `d - (d - offset) * (next / scale)`。
   * 少做这步补偿的表现是放大时视野始终咬住图片中心，指着的细节反而移出视野。
   */
  function zoomTo(next: number, anchor?: { x: number, y: number }) {
    const metrics = options.metrics()
    if (!metrics) return
    const target = clampImagePreviewScale(next)
    if (target === scale.value) return
    const center = options.center()
    const ratio = target / scale.value
    const dx = center && anchor ? anchor.x - center.x : 0
    const dy = center && anchor ? anchor.y - center.y : 0
    const moved = {
      x: dx - (dx - offset.value.x) * ratio,
      y: dy - (dy - offset.value.y) * ratio,
    }
    scale.value = target
    offset.value = clampImagePreviewOffset(moved, target, metrics)
  }

  /** 滚轮：向上放大、向下缩小，以指针为锚点。 */
  function handleWheel(event: ImagePreviewWheelInput) {
    if (event.deltaY === 0) return
    const factor = event.deltaY < 0 ? IMAGE_PREVIEW_ZOOM_FACTOR : 1 / IMAGE_PREVIEW_ZOOM_FACTOR
    zoomTo(scale.value * factor, { x: event.clientX, y: event.clientY })
  }

  /** 按下只记起点。贴合倍率下没有可拖的余量，直接不进入拖动。 */
  function handlePointerDown(event: ImagePreviewPointerInput) {
    if (event.button !== undefined && event.button !== 0) return
    if (scale.value <= IMAGE_PREVIEW_ZOOM_MIN) return
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.value.x,
      originY: offset.value.y,
      moved: false,
    }
  }

  function handlePointerMove(event: ImagePreviewPointerInput) {
    const metrics = options.metrics()
    if (!metrics || !drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < IMAGE_PREVIEW_DRAG_THRESHOLD_PX) return
    // 越过阈值的那一拍才接住指针：此后指针移出图片仍能继续平移，而单击不会被改派。
    if (!drag.moved) options.captureTarget?.()?.setPointerCapture(event.pointerId)
    drag.moved = true
    dragging.value = true
    offset.value = clampImagePreviewOffset(
      { x: drag.originX + dx, y: drag.originY + dy },
      scale.value,
      metrics,
    )
  }

  function finishDrag(event: ImagePreviewPointerInput) {
    if (!drag || drag.pointerId !== event.pointerId) return
    const target = options.captureTarget?.()
    if (target?.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
    if (drag.moved) suppressClickUntil = now() + IMAGE_PREVIEW_CLICK_SUPPRESSION_MS
    drag = undefined
    dragging.value = false
  }

  /**
   * 真发生过拖动才吃掉紧随其后的那一次 click，并且只吃一次。
   *
   * 遮罩靠 `click.self` 关闭预览：拖动图片后在遮罩上松手，那次 click 的目标是按下与松手
   * 目标的最近公共祖先，也就是遮罩本身，`.self` 于是成立——不吃掉它，拖一下图片就关掉了。
   */
  function consumeSuppressedClick(): boolean {
    if (now() > suppressClickUntil) return false
    suppressClickUntil = 0
    return true
  }

  /** 换图或重开时回到贴合状态；留着上一张的倍率会让新图以放大态突然出现。 */
  function reset() {
    scale.value = IMAGE_PREVIEW_ZOOM_MIN
    offset.value = { x: 0, y: 0 }
    dragging.value = false
    drag = undefined
    suppressClickUntil = 0
  }

  return {
    scale,
    offset,
    dragging,
    zoomTo,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    finishDrag,
    consumeSuppressedClick,
    reset,
  }
}
