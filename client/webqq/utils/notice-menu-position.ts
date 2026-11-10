export function getDesktopNoticeMenuPosition(button: Pick<DOMRect, 'left' | 'width' | 'bottom'>) {
  // 与侧栏内旧规则 top: calc(100% + 8px) / left: 50% 对齐；Teleport 到 body 后只能用视口坐标。
  return {
    top: button.bottom + 8,
    left: button.left + button.width / 2,
  }
}
