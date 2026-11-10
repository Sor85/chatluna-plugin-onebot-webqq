/**
 * 入口锚点的判定层：小胶囊被拖到哪里算合法。
 *
 * 提出来的是判定而不是 DOM 机械动作：约束有两条——入口必须整体留在视口里，以及视口比入口还小时
 * 要退回哪一边。这两条改坏了都不会报错，只会表现为小胶囊被拖出屏幕后再也点不回来。指针会话、
 * 元素测量与 localStorage 读写仍然留在 Capsule.vue。
 */

/**
 * 入口锚点：小胶囊当前占据的框。
 *
 * right/bottom 是入口外缘到视口右缘、下缘的距离，与 CSS 的 `right`/`bottom` 同义；width/height
 * 由实际渲染量出，不入存储——它们随机器人数量和头像栈折叠态变化，回填旧值会算错夹取边界。
 */
export interface CapsuleAnchor {
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

/** 会被记住的那一半：只有位置跨会话保留。 */
export type CapsuleAnchorPosition = Pick<CapsuleAnchor, 'right' | 'bottom'>

export interface CapsuleAnchorViewport {
  readonly width: number
  readonly height: number
}

/** 入口与视口边缘之间保留的最小间距。 */
export const CAPSULE_ANCHOR_VIEWPORT_MARGIN = 8

/** 读取存下来的入口位置。缺字段、非数字、NaN 与 Infinity 一律当作没存过，交给默认锚点。 */
export function normalizeCapsuleAnchorPosition(value: unknown): CapsuleAnchorPosition | undefined {
  if (!value || typeof value !== 'object') return
  const right = Reflect.get(value, 'right')
  const bottom = Reflect.get(value, 'bottom')
  if (typeof right !== 'number' || typeof bottom !== 'number') return
  if (!Number.isFinite(right) || !Number.isFinite(bottom)) return
  return { right, bottom }
}

/**
 * 把入口锚点夹回视口。
 *
 * 两端的取舍顺序是判定的一部分：先按「入口另一侧不越界」求上限，再用最小间距兜底。视口比入口还窄
 * 或还矮时上限会小于下限，这时保留下限，即贴住右缘/下缘——小胶囊是右下角入口，宁可左上侧溢出，
 * 也不能让它自己那一侧离开视口，否则唯一能点开观察窗的头像就到屏幕外去了。
 */
export function clampCapsuleAnchor(anchor: CapsuleAnchor, viewport: CapsuleAnchorViewport): CapsuleAnchor {
  const margin = CAPSULE_ANCHOR_VIEWPORT_MARGIN
  const maxRight = viewport.width - anchor.width - margin
  const maxBottom = viewport.height - anchor.height - margin
  return {
    ...anchor,
    right: Math.round(Math.max(margin, Math.min(anchor.right, maxRight))),
    bottom: Math.round(Math.max(margin, Math.min(anchor.bottom, maxBottom))),
  }
}
