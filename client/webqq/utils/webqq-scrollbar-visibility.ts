/**
 * 自定义滚动条的显隐时序。
 *
 * 提出来的是判定，不是 DOM 机械动作（ADR 0075）：轨道该现身还是该收起由「指针落在哪里、是不是
 * 正在拖」共同决定，改坏了不会报错，只会表现为轨道赖着不走或在用户正要抓它时抽走。轨道元素的
 * 创建、样式写入、事件绑定与计时器仍然留在指令里。
 *
 * 用命名转换而不是逐字段赋值，同样是 ADR 0075 的判据：`revealed`、`hideScheduled` 与「指针在
 * 哪」必须同拍变化。此前指令用一个 `hovering` 同时表示「指针在滚动区」和「指针在滑块上」，倒计时
 * 到点的守卫读的是这一个字段，于是指针停在滚动区里也会把轨道钉成常显——指针静止时轨道永不消失。
 * 两种悬停的后果本就相反：停在滚动区只需要一次位置提示，停在滑块上才是「正要抓它」。
 */

/** 指针此刻落在哪里。滑块与滚动区互斥：滑块盖在滚动区右缘上，命中滑块时滚动区收不到指针事件。 */
export type ScrollbarPointer = 'outside' | 'area' | 'thumb'

/** 一次可能改变显隐的外部线索。 */
export type ScrollbarCue =
  | 'pointer-enter-area'
  | 'pointer-move-area'
  | 'pointer-leave-area'
  | 'pointer-enter-thumb'
  | 'pointer-leave-thumb'
  | 'scroll'
  | 'focus-in'
  | 'focus-out'
  | 'drag-start'
  | 'drag-end'
  | 'hide-timeout'
  | 'unusable'

export interface ScrollbarVisibility {
  readonly pointer: ScrollbarPointer
  readonly dragging: boolean
  /** 轨道此刻是否应当可见。 */
  readonly revealed: boolean
  /** 是否应当有一个隐藏倒计时在跑；转成 false 时指令要把已有的计时器清掉。 */
  readonly hideScheduled: boolean
}

const initialVisibility: ScrollbarVisibility = {
  pointer: 'outside',
  dragging: false,
  revealed: false,
  hideScheduled: false,
}

export function createScrollbarVisibility(): ScrollbarVisibility {
  return initialVisibility
}

/**
 * 轨道被钉住：指针正指着滑块，或者正拖着它。此时倒计时到点也不收——把用户正要抓或已经抓住的
 * 东西抽走，比轨道多留一会儿糟得多。
 */
export function isScrollbarPinned(state: ScrollbarVisibility): boolean {
  return state.pointer === 'thumb' || state.dragging
}

/** 滑块是否该处于加宽态。与「被钉住」同一判据：指着它或拖着它。 */
export function isScrollbarThumbWide(state: ScrollbarVisibility): boolean {
  return isScrollbarPinned(state)
}

/** 现身一次并起倒计时：给出位置提示，随后照常收起。 */
function reveal(state: ScrollbarVisibility): ScrollbarVisibility {
  return { ...state, revealed: true, hideScheduled: true }
}

/** 现身并钉住：不排倒计时，已排的由指令清掉。 */
function pin(state: ScrollbarVisibility): ScrollbarVisibility {
  return { ...state, revealed: true, hideScheduled: false }
}

/** 放手：可见性先保持原样，收不收交给倒计时到点时再判。 */
function release(state: ScrollbarVisibility): ScrollbarVisibility {
  return { ...state, hideScheduled: true }
}

/** 立即收起，并且不留倒计时。 */
function conceal(state: ScrollbarVisibility): ScrollbarVisibility {
  return { ...state, revealed: false, hideScheduled: false }
}

export function applyScrollbarCue(state: ScrollbarVisibility, cue: ScrollbarCue): ScrollbarVisibility {
  switch (cue) {
    case 'pointer-enter-area':
    // 指针在滚动区里移动时也顺手把落点纠正回 area：滑块因内容变化从静止的指针下方移走时，
    // 浏览器要等下一次指针移动才补发滑块的 mouseleave，只认 leave 会把轨道永久钉住。
    case 'pointer-move-area':
      return reveal({ ...state, pointer: 'area' })
    // 指针移到滑块上时滚动区会先收到 mouseleave，紧随其后才是滑块的 mouseenter。顺序反过来时
    // 不能把已经认下的 thumb 抹回 outside，否则刚钉住的轨道会立刻排上倒计时。
    case 'pointer-leave-area':
      return release({ ...state, pointer: state.pointer === 'area' ? 'outside' : state.pointer })
    case 'pointer-enter-thumb':
      return pin({ ...state, pointer: 'thumb' })
    case 'pointer-leave-thumb':
      return release({ ...state, pointer: 'outside' })
    // 滚动与聚焦都只是提示位置；指针已经在滑块上时保持钉住，免得起一个到点也不生效的计时器。
    case 'scroll':
    case 'focus-in':
      return isScrollbarPinned(state) ? pin(state) : reveal(state)
    case 'focus-out':
      return release(state)
    case 'drag-start':
      return pin({ ...state, dragging: true })
    // 松手后交给倒计时：指针还停在滑块上就继续留着，已经移开则照常收起。
    case 'drag-end':
      return release({ ...state, dragging: false })
    case 'hide-timeout':
      return isScrollbarPinned(state) ? { ...state, hideScheduled: false } : conceal(state)
    // 内容缩回到不足一屏、轨道被裁成零高或元素已经离开文档：几何不可用时无条件收起。
    case 'unusable':
      return conceal(state)
  }
}
