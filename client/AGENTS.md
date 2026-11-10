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
- 胶囊位移不能加在 `.onebot-webqq-host` 上：host 带位移会成为 fixed 摘要与观察窗的包含块。也不能加在 `.onebot-webqq-layout-root` 上：Anime.js `createLayout` 在 record / animate 时给 root 加 `transition: none !important` 并接管子节点的 `translate`，root 自身的位移会瞬间跳变或与头像栈错位。它只屏蔽带 `transform` 的祖先，因此位移放在外层 `.onebot-webqq-dock-slide`，摘要 `.onebot-webqq__body` 用一一对应的规则同步。
  - 展开补偿与贴边位移分属两个属性：补偿用 `left` / `margin-right`，时长曲线等同头像栈 FLIP，展开时左缘不动；贴边用 `translate` 带弹簧。两者共用一个属性会让左缘来回越出视口，指针反复进出头像栈造成抖动。
  - 胶囊以右缘为锚点，锚点 `right` 按测量时的宽度夹取，会因机器人列表晚到或头像栈展开而过期，位移按右缘推算（见 `capsule.tsx` 的 `dockOffset` / `capsuleShift`）。贴边判定规则在 `capsule-anchor.ts`，由 `tests/capsule-dock.test.ts` 覆盖。
  - 滑出与收起动画分别写在 `is-docked-*` 和 `is-dock-hidden` 规则里，因为 CSS 过渡采用目标状态的参数。弹簧曲线 `linear()` 放在 `@supports` 中，外面保留 `cubic-bezier` 作为回退：同一规则里的回退声明会被压缩器合并掉。
  - FLIP 子节点（`children` 列表里的胶囊、头像容器、头像栈、头像按钮）的 CSS 过渡在动画期间会被吞掉。收起往往同时触发头像栈折叠，这些节点上需要可靠播放的效果用关键帧，如头像淡出。依附于胶囊几何的装饰也不能放进这些节点，FLIP 期间位置会停在旧宽度上：贴边红点挂在 host 下，按屏幕边缘 `position: fixed` 定位。
  - 滑动全程内容保持不透明，左右两侧的收起动画才一致。滑到边缘后才淡出把手里的残留内容、淡入红点。时机由 `transitionend` 驱动的 `is-dock-settled` 决定，不能用固定延迟：松手时头像栈先展开再折叠会改写展开补偿，位移过渡被打断重来，实际收起时长不固定。
- 只执行一次的挂载 effect 不能持有会影响可见状态的计时器：开发环境 StrictMode 与 HMR 会先卸载再挂载，计时器被清掉后状态会卡住。头像引导的收起计时因此由依赖引导状态的 effect 管理。
