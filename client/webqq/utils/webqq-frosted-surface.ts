import * as React from 'react'

// 毛玻璃开关同样写到 body：Portal 到 body 的右键菜单、Dialog 和二级页拿不到观察窗根节点上的 is-frosted
// 状态类，统一由 body[data-onebot-webqq-frosted] 驱动实体/雾化双态，避免给每个浮层组件都穿一条 frosted prop。
// dataset 键带 onebot-webqq 命名空间：沙盒插件用 data-sandbox-frosted，两个插件可能同时运行在同一个页面。
export function useWebQQFrostedSurfaceFlag(enabled: boolean): void {
  React.useEffect(() => {
    if (enabled) document.body.dataset.onebotWebqqFrosted = 'true'
    else delete document.body.dataset.onebotWebqqFrosted
    return () => {
      delete document.body.dataset.onebotWebqqFrosted
    }
  }, [enabled])
}
