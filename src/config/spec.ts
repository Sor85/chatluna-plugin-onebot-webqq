import type { WebQQProtocol } from '../onebot/protocol'

// 配置规格：插件全部配置项的唯一权威声明。逐项记录键名、默认值、是否为镜像配置项，
// 以及空字符串是否视为未设置。Schema 默认值、服务端兜底、下发 payload、前端配置镜像
// 的类型与 ref 初始值都从这里派生，因此每个默认值在整个仓库里只写一次。
//
// 本文件会被前端引用，不得引用 schemastery 或任何服务端模块，否则整条依赖链会被打进浏览器产物。
// 需要 Schema 的构造代码在 ./schema.ts。

export type WebQQChatStyle = 'qq' | 'tim'
export type WebQQColorMode = 'auto' | 'light' | 'dark'
export type WebQQStorageBackend = 'browser' | 'database'

/** 单个配置项的规格。省略 `default` 即「这个配置项没有默认值」。 */
interface ConfigItemSpec<Value = unknown> {
  readonly default?: Value
  /** 标为 true 即镜像配置项：会下发给控制台前端。未标注的只在服务端消费。 */
  readonly mirrored?: true
  /** 标为 true 时空字符串与未设置同义，由读取函数统一规范化，使用点不再各写运算符。 */
  readonly blankIsUnset?: true
}

// 规格本体不导出：默认值一律经下面的读取函数取，否则数组默认值会被消费方共享同一个实例。
// `satisfies` 而不是类型标注：标注会把 mirrored 收敛成 boolean，镜像配置项就无法在类型层面筛出来。
// 枚举与数组默认值需要显式 `as`，否则字面量会被放宽成 string / never[]。
const configSpec = {
  // 连接设置
  onebotUseRuntimeBots: { default: true },
  onebotSelfIds: { default: [] as string[] },
  onebotProtocol: { default: 'napcat' as WebQQProtocol },

  // 历史与缓存
  historyLimit: { default: 100 },
  webQQMessageCacheLimit: { default: 100, mirrored: true },
  webQQStorageBackend: { default: 'database' as WebQQStorageBackend, mirrored: true, blankIsUnset: true },
  webQQImageCacheEnabled: { default: true },
  webQQImageCacheLimitMB: { default: 100 },
  webQQImageCacheItemLimitMB: { default: 10 },

  // 小胶囊设置
  enableCapsuleFrostedGlass: { default: true, mirrored: true },
  useCompactCapsuleShadow: { default: true, mirrored: true },
  showWebQQCapsuleUnread: { default: true, mirrored: true },
  // 登录页与角色初始化向导是全屏流程，胶囊不应盖在表单上。
  hiddenCapsuleActivityIds: { default: ['/logs', '/login', '/login/forgot', '/setup'], mirrored: true },

  // WebQQ 设置
  enableWebQQFrostedGlass: { default: true, mirrored: true },
  enableWebQQSend: { default: false, mirrored: true },
  webQQChatStyle: { default: 'tim' as WebQQChatStyle, mirrored: true, blankIsUnset: true },
  webQQTimBubbleTail: { default: true, mirrored: true },
  webQQColorMode: { default: 'auto' as WebQQColorMode, mirrored: true, blankIsUnset: true },
  webQQAccentColor: { default: '#2563eb', mirrored: true, blankIsUnset: true },
  allowWebQQResize: { default: false, mirrored: true },
  webQQMarkRecalledMessages: { default: true },
  hideWebQQGroupLevel: { default: true, mirrored: true },
  showWebQQAffinity: { default: false, mirrored: true },
  showWebQQCharacterThinking: { default: true },
  showWebQQThinkingTokens: { default: true, mirrored: true },
  showWebQQThinkingTiming: { default: true, mirrored: true },

  // 开发者选项
  onebotMockBotCount: { default: 0 },
  webQQMockEnvironment: { default: false },
  debug: { default: false, mirrored: true },
} satisfies Record<string, ConfigItemSpec>

type ConfigSpec = typeof configSpec
export type ConfigKey = keyof ConfigSpec

/** 带默认值的配置项。没有默认值的配置项不能参与「落默认值」这件事，因此读取函数只接受这些键。 */
export type DefaultedConfigKey = {
  [K in ConfigKey]: ConfigSpec[K] extends { default: unknown } ? K : never
}[ConfigKey]

/** 镜像配置项：会下发给控制台前端的那一批。 */
export type MirroredConfigKey = {
  [K in ConfigKey]: ConfigSpec[K] extends { mirrored: true } ? K : never
}[ConfigKey]

export type ConfigValue<K extends ConfigKey> = ConfigSpec[K] extends { default: infer Value } ? Value : never

/** 全部镜像配置项的取值：下发 payload 与前端配置镜像的类型都从这里派生。 */
export type MirroredConfigValues = { [K in MirroredConfigKey]: ConfigValue<K> }

/** 读取函数的入参形状。规格不能引用 `Config`（它在 schema.ts 里，沾 schemastery），这里按键集约束即可。 */
export type ConfigInput = { readonly [K in ConfigKey]?: unknown }

// configSpec 的每一项都是自己的字面量类型，逐项访问 `.mirrored` 会因为部分成员没声明该属性而报错。
// 走一次接口视图即可，两者结构兼容。
const configItems: Readonly<Record<ConfigKey, ConfigItemSpec>> = configSpec

export const mirroredConfigKeys = (Object.keys(configSpec) as ConfigKey[])
  .filter((key): key is MirroredConfigKey => !!configItems[key].mirrored)

// 数组默认值逐次复制：直接返回规格里的那一个实例，任何消费方的一次 push 都会永久污染默认值。
function cloneDefault(value: unknown) {
  return Array.isArray(value) ? [...value] : value
}

/** 配置项的默认值。前端配置镜像的 ref 初始值走这里，服务端兜底走 readConfigValue。 */
export function readConfigDefault<K extends DefaultedConfigKey>(key: K): ConfigValue<K> {
  return cloneDefault(configItems[key].default) as ConfigValue<K>
}

/**
 * 按规格读取一个配置项。
 *
 * 只有未设置（undefined / null）才落默认值：用「假值即落默认」会把管理员关掉的开关重新打开、
 * 把填 0 的数值静默换成默认值。标注 blankIsUnset 的枚举与颜色配置项额外把空字符串视为未设置，
 * 否则界面会拿到一个无效取值。
 */
export function readConfigValue<K extends DefaultedConfigKey>(config: ConfigInput | undefined, key: K): ConfigValue<K> {
  const item = configItems[key]
  const value = config?.[key]
  if (value === undefined || value === null) return cloneDefault(item.default) as ConfigValue<K>
  if (item.blankIsUnset && value === '') return cloneDefault(item.default) as ConfigValue<K>
  return value as ConfigValue<K>
}

/** 下发给控制台前端的镜像配置项取值。 */
export function readMirroredConfigValues(config: ConfigInput | undefined): MirroredConfigValues {
  const values = {} as Record<MirroredConfigKey, unknown>
  for (const key of mirroredConfigKeys) {
    values[key] = readConfigValue(config, key)
  }
  return values as MirroredConfigValues
}
