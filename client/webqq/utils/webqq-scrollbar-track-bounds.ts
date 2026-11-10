/**
 * 自定义滚动条轨道的可见区域计算。
 *
 * 提出来的是判定，不是 DOM 机械动作：「轨道从哪里开始」这件事由悬浮顶栏的存在与否决定，改坏了
 * 不会报错，只会表现为轨道压在顶栏上或者整条轨道缺一截。轨道元素的创建、样式写入与事件绑定仍然
 * 留在指令里。
 *
 * 注入的是最小结构接口而不是 DOM 类型：只需要沿祖先链上行、按选择器认出兄弟节点、以及读一个
 * 矩形，`HTMLElement` 天然满足这三项，测试写一个内存替身即可。
 */

export interface ScrollbarBoundsRect {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface ScrollbarBoundsNode {
  readonly parentElement: ScrollbarBoundsNode | null
  readonly children: ArrayLike<ScrollbarBoundsNode>
  matches(selector: string): boolean
  getBoundingClientRect(): ScrollbarBoundsRect
}

/**
 * 页内顶栏的选择器。
 *
 * 聊天顶栏是 `position: absolute; inset: 0 0 auto`，消息区用 `padding-top: 84px` 从顶栏背后
 * 起算——毛玻璃顶栏必须有真实消息可采样（ADR 0002 把模糊放在顶栏的 `::before` 上），所以内容
 * 延伸是对的，滚动条轨道不应该跟着延伸。二级页顶栏（资料卡、表情面板）是同一个形状。
 *
 * 只写 `header` 不够：这两处顶栏都是 `<header>`，但选择器同时列出类名，是为了让「换成 div 但
 * 保留类名」不至于静默失去裁剪。
 */
export const SCROLLBAR_HEADER_SELECTOR = 'header, .onebot-webqq-webqq__secondary-page-header'

/**
 * 沿祖先链寻找当前滚动区域**前面**的页内顶栏，返回它的底缘。
 *
 * 找前面的兄弟而不是任意后代：顶栏一定排在滚动区域之前，往后找会把滚动内容里的次级标题也当成
 * 顶栏（表情面板的「常用」「推荐」分组标题就是 `<header>`），轨道会被无端截掉一大截。
 *
 * 一个顶栏都没有时退回外壳顶缘；连外壳都没有时退回负无穷，即不裁剪。
 */
export function findScrollbarHeaderBottom(
  element: ScrollbarBoundsNode,
  shell: ScrollbarBoundsNode | undefined,
): number {
  let branch: ScrollbarBoundsNode | null = element
  while (branch && branch !== shell) {
    const parent: ScrollbarBoundsNode | null = branch.parentElement
    if (!parent) break
    const branchIndex = Array.prototype.indexOf.call(parent.children, branch)
    for (let index = branchIndex - 1; index >= 0; index -= 1) {
      const sibling = parent.children[index]
      if (sibling && sibling.matches(SCROLLBAR_HEADER_SELECTOR)) {
        return sibling.getBoundingClientRect().bottom
      }
    }
    branch = parent
  }
  return shell?.getBoundingClientRect().top ?? Number.NEGATIVE_INFINITY
}

export interface VisibleScrollbarRect extends ScrollbarBoundsRect {
  readonly width: number
  readonly height: number
}

/**
 * 轨道实际可以占用的矩形：滚动区域自身的矩形，先被顶栏底缘截顶，再被观察窗外壳夹住四边。
 * 没有外壳时（Teleport 到 body 的浮层里的滚动区域）只截顶。
 */
export function computeVisibleScrollbarRect(
  element: ScrollbarBoundsNode,
  shellElement: ScrollbarBoundsNode | undefined,
): VisibleScrollbarRect {
  const rect = element.getBoundingClientRect()
  const shell = shellElement?.getBoundingClientRect()
  const topBoundary = findScrollbarHeaderBottom(element, shellElement)

  if (!shell) {
    const top = Math.max(rect.top, topBoundary)
    return {
      top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: Math.max(0, rect.right - rect.left),
      height: Math.max(0, rect.bottom - top),
    }
  }

  const top = Math.max(rect.top, shell.top, topBoundary)
  const right = Math.min(rect.right, shell.right)
  const left = Math.max(rect.left, shell.left)
  const bottom = Math.min(rect.bottom, shell.bottom)
  return {
    top,
    right,
    bottom,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}
