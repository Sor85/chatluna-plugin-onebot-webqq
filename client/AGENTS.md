# 前端约定

适用范围：`client/`。同时遵守根 `AGENTS.md`；跨端契约说明见 `src/AGENTS.md`。

- React 客户端挂到 v2 的 `overlay` 插槽；观察窗关闭时保留消息订阅。组件使用 `@chatluna/ui-kit`，图标沿用 Tabler SVG。
- 原版 DOM 类名和布局继续保留，避免改写 React 时同时改变 TIM / QQ 气泡、窗口尺寸和交互。不要重新引入 Vue、Reka 或 Koishi Console。
- 毛玻璃采用 ui-kit 的 `--glass`、`--glass-page`、`--glass-blur`，集中在 `styles/glass.css`。普通模式直接继承宿主令牌；插件强制明暗与宿主相反时，局部镜像 ui-kit 对应模式，不改全局主题。
- 背景模糊只施加在窗口伪元素与浮层，不施加在聊天列或父容器，避免影响后代的背景采样。保留独立的胶囊与观察窗毛玻璃开关。
- 使用标准 `backdrop-filter`。当前 CSS 压缩器会将同一规则内的标准/前缀声明合并成最后一项，不能把 WebKit 前缀放在标准声明后面。生产产物由测试守住，不能只检查开发样式。
- Portal 根显式带 `is-color-light` / `is-color-dark`，主题和 Dialog 遮罩选择器只命中 WebQQ，不能覆盖宿主或其他插件。
- 滚动条复用 `webqq/utils/webqq-scrollbar.ts`。挂在真实 DOM 上的回调 ref 必须保持稳定，不能因为组件重渲染不断拆卸轨道；卸载时清理 DOM、observer 与事件。
- 浏览器偏好统一通过 `@chatluna/ui-storage`；消息缓存保留 IndexedDB。界面文案写 `locales/zh.yml` / `en.yml` 并保持键及插值参数相同；协议消息原文不翻译。
- v2 `useTranslate` 的引用不会随语言改变，记忆化渲染使用 `i18n.ts` 的 `useT`；树外控制器通过 `tr` 取得当前翻译。
- 原生文件选择和 contenteditable 消息编辑器保留其输入语义。其他基础控件优先使用 ui-kit。不增加 cursor 样式，不关闭宿主组件自带的交互反馈。
- 胶囊贴边与展开补偿只对 `.onebot-webqq-layout-root` 和 `.onebot-webqq__body` 使用 `translate`，不能加在 `.onebot-webqq-host` 上：host 带位移会成为 fixed 摘要与观察窗的包含块。胶囊以右缘为锚点，锚点 `right` 按测量时的宽度夹取，会因机器人列表晚到或头像栈展开而过期，位移按右缘推算（见 `capsule.tsx` 的 `dockOffset` / `capsuleShift`）。贴边判定规则在 `capsule-anchor.ts`，由 `tests/capsule-dock.test.ts` 覆盖。
