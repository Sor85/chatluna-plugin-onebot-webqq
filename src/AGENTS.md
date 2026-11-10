# 服务端约定

适用范围：`src/`。同时遵守根 `AGENTS.md`；界面规则见 `client/AGENTS.md`。

- 入口 `index.ts` 只声明 Config、inject、类型扩展与 apply；装配在 `runtime.ts`。服务通过当前 Cordis fiber 注入，监听器、路由、定时器都随 fiber 回收。
- 使用 Satori `Session`，不再依赖旧 Koishi Console 或 ChatLuna v1 事件。
- `config/spec.ts` 与 `shared/console-contract.ts` 是跨端契约，不引入服务端运行时依赖。配置默认值与镜像键在 spec 维护；增删键同步 schema。
- OneBot `_request` 返回完整信封，业务失败不一定 reject。所有动作统一经过 `onebot/actions.ts`，禁止把失败信封视为操作成功。
- NapCat / LLBot 以 `message_seq` 分页；SnowLuma 以有符号 `message_id` 为锚点，`sequence` 字段在此模式下表示分页游标，不是原始 QQ 序号。不要把私聊消息 ID 当作递增序号。
- 私聊的会话对象优先从 `private:<userId>` 解析。Satori 发出的消息中 `session.userId` 是机器人，不能据此把私聊回显归到机器人自己。
- ChatLuna 联动使用 `chat/receive`、`chatluna/agent-status`、`chatluna/agent-step`；保留 busy 先于 receive、回复晚于 idle 的情况。输入用量取最后一步的普通输入加缓存读写，输出累加；内心活动只读 `<think>`，不混入模型原生 reasoning。
- 好感度从角色引擎 `people()` 的 `favor` 读取，按当前会话绑定的预设匹配。旧版 relationship、scopeId 与日程活动没有等价接口，不提供空占位。
- 媒体代理在已排除 SPA 回退的路径下，显式校验登录 cookie。保留远程地址、重定向与媒体文件标识的校验，不能改成匿名任意 URL 代理。
