import type { MirroredConfigValues } from '../config/spec'
import type { CapsuleSnapshot } from '../capsule/state/types'
import type { OneBotRobotState } from '../onebot/types'
import type {
  WebQQContacts,
  WebQQForwardSendInput,
  WebQQFriendAction,
  WebQQGroupAction,
  WebQQGroupInfo,
  WebQQGroupInfoQuery,
  WebQQLiveMessage,
  WebQQMessage,
  WebQQMessageCachePayload,
  WebQQMessageCacheQuery,
  WebQQMessageQuery,
  WebQQMessageReactionInput,
  WebQQMessageRecallInput,
  WebQQMessageSearchQuery,
  WebQQMessageSearchResult,
  WebQQNotice,
  WebQQNoticeAction,
  WebQQProfile,
  WebQQProfileQuery,
  WebQQRecallPayload,
  WebQQRecordTranscriptionQuery,
  WebQQSelfProfileUpdate,
  WebQQSendPayload,
  WebQQStoredState,
} from '../webqq/types'

// WebUI 契约：前端与插件之间全部 action 与实时 state 的唯一声明。服务端按它注册，客户端按它调用，
// 任何一端漏改都编译失败，而不是等到运行时——action 名写错时前端只会显示「加载聊天历史失败」。
//
// 本文件会被前端引用，import 闭包里不得出现 schemastery、cordis 或任何服务端运行时模块，
// 否则整条依赖链会被打进浏览器产物。契约只声明、不注册。

/** 请求方向：前端问、后端答。注册为 `chatluna_webui` 的 action。 */
export interface ConsoleRequests {
  'onebot-webqq.contacts': () => Promise<WebQQContacts>
  'onebot-webqq.messages': (query: WebQQMessageQuery) => Promise<WebQQMessage[]>
  'onebot-webqq.messages.search': (query: WebQQMessageSearchQuery) => Promise<WebQQMessageSearchResult>
  'onebot-webqq.group-info': (query: WebQQGroupInfoQuery) => Promise<WebQQGroupInfo>
  'onebot-webqq.record.transcribe': (query: WebQQRecordTranscriptionQuery) => Promise<string>
  'onebot-webqq.notices': () => Promise<WebQQNotice[]>
  'onebot-webqq.notice-action': (action: WebQQNoticeAction) => Promise<void>
  'onebot-webqq.send': (payload: WebQQSendPayload) => Promise<void>
  'onebot-webqq.message-recall': (input: WebQQMessageRecallInput) => Promise<void>
  'onebot-webqq.message-reaction': (input: WebQQMessageReactionInput) => Promise<void>
  'onebot-webqq.profile': (query: WebQQProfileQuery) => Promise<WebQQProfile>
  'onebot-webqq.self-profile': (input: WebQQSelfProfileUpdate) => Promise<void>
  'onebot-webqq.friend-action': (input: WebQQFriendAction) => Promise<void>
  'onebot-webqq.group-action': (input: WebQQGroupAction) => Promise<void>
  'onebot-webqq.forward-send': (input: WebQQForwardSendInput) => Promise<void>
  'onebot-webqq.bot.select': (input: { selfId: string }) => Promise<OneBotRobotState>
  'onebot-webqq.storage.load': () => Promise<WebQQStoredState>
  'onebot-webqq.storage.save': (state: WebQQStoredState) => Promise<void>
  'onebot-webqq.messages.cache.load': (query: WebQQMessageCacheQuery) => Promise<WebQQMessage[]>
  'onebot-webqq.messages.cache.save': (payload: WebQQMessageCachePayload) => Promise<void>
}

/**
 * 小胶囊、机器人列表与镜像配置合成一份实时 state。三者都小，合在一起客户端只订阅一次；
 * 服务端按快照哈希去重，没变化时不下发。`startedAt` 让客户端识别插件重启。
 */
export interface WebQQRuntimeState extends OneBotRobotState {
  startedAt: number
  capsule?: CapsuleSnapshot
  config: MirroredConfigValues
}

/**
 * 实时事件：新消息与撤回。v2 的 state 只有快照与追加两种推送，事件流因此是一个追加型数组 state，
 * 每条带全局递增的 `seq`。客户端按 `seq` 去重：首个快照里的旧事件只用来对齐游标，不重放；断线重连后
 * 快照里比游标新的事件照常处理。
 */
export type WebQQEvent =
  | { seq: number, type: 'message', payload: WebQQLiveMessage }
  | { seq: number, type: 'recall', payload: WebQQRecallPayload }

export const RUNTIME_STATE = 'onebot-webqq.runtime'
export const EVENTS_STATE = 'onebot-webqq.events'

export const consoleRequestNames = [
  'onebot-webqq.contacts',
  'onebot-webqq.messages',
  'onebot-webqq.messages.search',
  'onebot-webqq.group-info',
  'onebot-webqq.record.transcribe',
  'onebot-webqq.notices',
  'onebot-webqq.notice-action',
  'onebot-webqq.send',
  'onebot-webqq.message-recall',
  'onebot-webqq.message-reaction',
  'onebot-webqq.profile',
  'onebot-webqq.self-profile',
  'onebot-webqq.friend-action',
  'onebot-webqq.group-action',
  'onebot-webqq.forward-send',
  'onebot-webqq.bot.select',
  'onebot-webqq.storage.load',
  'onebot-webqq.storage.save',
  'onebot-webqq.messages.cache.load',
  'onebot-webqq.messages.cache.save',
] as const satisfies readonly (keyof ConsoleRequests)[]

// 双向键集断言：名字数组的元素集与契约的键集必须完全相等，运行期守卫（注册遍历）读这个数组。
type AssertTrue<T extends true> = T
type KeySetsEqual<A extends PropertyKey, B extends PropertyKey> =
  [Exclude<A, B>] extends [never]
    ? ([Exclude<B, A>] extends [never] ? true : false)
    : false

export type _RequestNamesMatchContract = AssertTrue<KeySetsEqual<keyof ConsoleRequests, typeof consoleRequestNames[number]>>

declare module '@chatluna/ui-client/client' {
  interface States {
    'onebot-webqq.runtime': WebQQRuntimeState
    'onebot-webqq.events': WebQQEvent[]
  }
  interface Actions extends ConsoleRequests {}
}
