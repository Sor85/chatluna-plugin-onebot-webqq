import Schema from 'schemastery'
import type { WebQQProtocol } from '../onebot/protocol'
import {
  readConfigDefault,
  type ConfigKey,
  type ConfigValue,
  type WebQQChatStyle,
  type WebQQColorMode,
  type WebQQStorageBackend,
} from './spec'

// `Config` 保持手写 interface，不从配置规格派生：它由包入口对外导出，派生成映射类型后使用者在 IDE 里
// 看到的是展不开的条件类型。「漏改一个配置项会编译报错」由本文件末尾的双向键集断言提供。
export interface Config {
  debug?: boolean
  onebotUseRuntimeBots?: boolean
  onebotSelfIds?: string[]
  onebotMockBotCount?: number
  onebotProtocol?: WebQQProtocol
  historyLimit?: number
  webQQMessageCacheLimit?: number
  webQQImageCacheEnabled?: boolean
  webQQImageCacheLimitMB?: number
  webQQImageCacheItemLimitMB?: number
  webQQMarkRecalledMessages?: boolean
  enableWebQQFrostedGlass?: boolean
  enableWebQQSend?: boolean
  webQQChatStyle?: WebQQChatStyle
  webQQTimBubbleTail?: boolean
  webQQColorMode?: WebQQColorMode
  webQQAccentColor?: string
  enableCapsuleFrostedGlass?: boolean
  hiddenCapsuleActivityIds?: string[]
  allowWebQQResize?: boolean
  hideWebQQGroupLevel?: boolean
  showWebQQAffinity?: boolean
  showWebQQCharacterThinking?: boolean
  showWebQQThinkingTokens?: boolean
  showWebQQThinkingTiming?: boolean
  showWebQQCapsuleUnread?: boolean
  webQQStorageBackend?: WebQQStorageBackend
  webQQMockEnvironment?: boolean
}

// Schema 的形状手写：分组、字段顺序、控件类型、数值上下限与说明文案都不生成，只有默认值从配置规格读取。
// v2 的 SchemaForm 缺 label 时把配置键当标题显示，所以每个字段都写 `extra('label')`。
export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    onebotUseRuntimeBots: Schema.boolean().default(readConfigDefault('onebotUseRuntimeBots')).extra('label', '使用全部 OneBot 机器人')
      .description('使用当前运行时里所有可用的 OneBot 机器人，关闭后只使用下方 selfId 集合'),
    onebotSelfIds: Schema.array(Schema.string()).role('table').default(readConfigDefault('onebotSelfIds')).extra('label', '机器人 selfId 集合')
      .description('关闭上一项时允许使用的 OneBot 机器人 selfId 集合'),
    onebotProtocol: Schema.union([
      Schema.const('napcat').description('NapCat'),
      Schema.const('llbot').description('LLBot'),
      Schema.const('snowluma').description('SnowLuma'),
    ]).default(readConfigDefault('onebotProtocol')).role('radio').extra('label', 'OneBot 实现')
      .description('WebQQ 读取接口使用的 OneBot 实现协议'),
  }).description('连接设置'),

  Schema.object({
    historyLimit: Schema.natural().min(1).max(100).default(readConfigDefault('historyLimit')).extra('label', '历史加载条数')
      .description('每次加载聊天历史的消息数量'),
    webQQMessageCacheLimit: Schema.natural().min(1).max(1000).default(readConfigDefault('webQQMessageCacheLimit')).extra('label', '会话缓存条数')
      .description('每个 WebQQ 会话保留的最近消息缓存数量'),
    webQQStorageBackend: Schema.union([
      Schema.const('database').description('数据库'),
      Schema.const('browser').description('浏览器'),
    ]).default(readConfigDefault('webQQStorageBackend')).role('radio').extra('label', '状态存储位置')
      .description('最近会话、未读数与消息缓存的存储位置'),
    webQQImageCacheEnabled: Schema.boolean().default(readConfigDefault('webQQImageCacheEnabled')).extra('label', '图片代理内存缓存')
      .description('启用 WebQQ 图片代理内存缓存，会额外占用服务器内存'),
    webQQImageCacheLimitMB: Schema.natural().min(1).max(4096).default(readConfigDefault('webQQImageCacheLimitMB')).extra('label', '图片缓存总上限（MB）')
      .description('WebQQ 图片代理内存缓存总上限'),
    webQQImageCacheItemLimitMB: Schema.natural().min(1).max(1024).default(readConfigDefault('webQQImageCacheItemLimitMB')).extra('label', '单张图片缓存上限（MB）')
      .description('单张图片超过此大小时不写入内存缓存'),
  }).description('历史与缓存'),

  Schema.object({
    enableCapsuleFrostedGlass: Schema.boolean().default(readConfigDefault('enableCapsuleFrostedGlass')).extra('label', '小胶囊毛玻璃')
      .description('启用小胶囊毛玻璃效果'),
    showWebQQCapsuleUnread: Schema.boolean().default(readConfigDefault('showWebQQCapsuleUnread')).extra('label', '显示未读数')
      .description('在小胶囊机器人头像上显示 WebQQ 总未读数'),
    hiddenCapsuleActivityIds: Schema.array(Schema.string()).role('onebot-webqq:route-select').default(readConfigDefault('hiddenCapsuleActivityIds')).extra('label', '隐藏小胶囊的页面')
      .description('打开这些侧边栏页面时不显示小胶囊'),
  }).description('小胶囊设置'),

  Schema.object({
    enableWebQQFrostedGlass: Schema.boolean().default(readConfigDefault('enableWebQQFrostedGlass')).extra('label', 'WebQQ 毛玻璃')
      .description('启用 WebQQ 毛玻璃效果'),
    enableWebQQSend: Schema.boolean().default(readConfigDefault('enableWebQQSend')).extra('label', '消息发送')
      .description('启用 WebQQ 消息发送功能'),
    webQQChatStyle: Schema.union([
      Schema.const('tim').description('TIM'),
      Schema.const('qq').description('QQ'),
    ]).default(readConfigDefault('webQQChatStyle')).role('radio').extra('label', '聊天页面样式')
      .description('WebQQ 聊天页面样式'),
    webQQTimBubbleTail: Schema.boolean().default(readConfigDefault('webQQTimBubbleTail')).extra('label', 'TIM 气泡尖角')
      .description('显示 TIM 气泡小尖角'),
    webQQColorMode: Schema.union([
      Schema.const('auto').description('自动'),
      Schema.const('light').description('明亮'),
      Schema.const('dark').description('暗色'),
    ]).default(readConfigDefault('webQQColorMode')).role('radio').extra('label', '颜色模式')
      .description('自动模式跟随 ChatLuna 主题'),
    webQQAccentColor: Schema.string().default(readConfigDefault('webQQAccentColor')).role('color').extra('label', '强调色')
      .description('WebQQ 主题色'),
    allowWebQQResize: Schema.boolean().default(readConfigDefault('allowWebQQResize')).extra('label', '允许调整窗口大小')
      .description('允许拖动 WebQQ 边缘调整窗口宽高'),
    webQQMarkRecalledMessages: Schema.boolean().default(readConfigDefault('webQQMarkRecalledMessages')).extra('label', '保留撤回的消息')
      .description('保留被撤回的消息并显示删除线，关闭后显示撤回事件并移除原消息'),
    hideWebQQGroupLevel: Schema.boolean().default(readConfigDefault('hideWebQQGroupLevel')).extra('label', '隐藏群等级')
      .description('隐藏 WebQQ 消息中的群等级徽标'),
    showWebQQAffinity: Schema.boolean().default(readConfigDefault('showWebQQAffinity')).extra('label', '显示好感度')
      .description('在用户昵称右侧显示 ChatLuna 角色引擎记录的好感度'),
    showWebQQCharacterThinking: Schema.boolean().default(readConfigDefault('showWebQQCharacterThinking')).extra('label', '显示内心活动')
      .description('显示 ChatLuna 角色引擎的 think 内容'),
    showWebQQThinkingTokens: Schema.boolean().default(readConfigDefault('showWebQQThinkingTokens')).extra('label', '显示 token 用量')
      .description('显示 ChatLuna 回复的输入与输出 token'),
    showWebQQThinkingTiming: Schema.boolean().default(readConfigDefault('showWebQQThinkingTiming')).extra('label', '显示耗时')
      .description('显示 ChatLuna 回复的 TTFT、TPS 与总耗时'),
  }).description('WebQQ 设置'),

  Schema.object({
    onebotMockBotCount: Schema.natural().max(20).default(readConfigDefault('onebotMockBotCount')).extra('label', '模拟机器人数量')
      .description('额外模拟的 OneBot 机器人数量，仅用于验证小胶囊的多机器人展示'),
    webQQMockEnvironment: Schema.boolean().default(readConfigDefault('webQQMockEnvironment')).extra('label', '模拟环境')
      .description('只使用其他插件提供的虚拟 OneBot 机器人（例如 OneBot 沙盒），不接触真实机器人'),
    debug: Schema.boolean().default(readConfigDefault('debug')).extra('label', '调试日志')
      .description('输出调试信息'),
  }).description('开发者选项'),
])

// 双向键集断言：配置规格的键集与 `Config` 的键集必须完全相等，多一个少一个都编译失败。
type AssertTrue<T extends true> = T
type KeySetsEqual<A extends PropertyKey, B extends PropertyKey> =
  [Exclude<A, B>] extends [never]
    ? ([Exclude<B, A>] extends [never] ? true : false)
    : false

export type _ConfigKeysMatchSpec = AssertTrue<KeySetsEqual<keyof Config, ConfigKey>>

// 配置规格的默认值必须能落进 `Config` 的字段类型，否则两处对同一个配置项的取值类型已经漂移。
export type _SpecDefaultsMatchConfig = AssertTrue<
  [{
    [K in ConfigKey & keyof Config]: ConfigValue<K> extends Config[K] ? never : K
  }[ConfigKey & keyof Config]] extends [never] ? true : false
>
