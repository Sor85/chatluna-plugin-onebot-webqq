// 把 Portal 浮层提升到 Top Layer：backdrop-filter 才能采样已经合成的观察窗
// （含外壳 ::before 的毛玻璃），而不是被窗口伪层这个 Backdrop Root 挡住。
// popover 是渐进增强，老引擎没有 showPopover 时保持普通 fixed 浮层。调用方在挂载后的 layout effect 里调用。
export function showWebQQPopover(element: HTMLElement | null | undefined): void {
  if (!element || typeof element.showPopover !== 'function' || !element.isConnected) return
  try {
    if (!element.matches(':popover-open')) element.showPopover()
  } catch {
    // 已经打开，或当前文档还不支持 popover
  }
}
