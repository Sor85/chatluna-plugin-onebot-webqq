import { callAction, subscribeLive } from '@chatluna/ui-client/client'
import { readMirroredConfigValues, type MirroredConfigValues } from '../src/config/spec'
import type { CapsuleSnapshot } from '../src/capsule/state/types'
import type { ConsoleRequests, WebQQEvent } from '../src/shared/console-contract'
import { EVENTS_STATE, RUNTIME_STATE } from '../src/shared/console-contract'
import type { OneBotRobotProfile, OneBotRobotState } from '../src/onebot/types'
import type { CapsuleAnchor } from './capsule/capsule-anchor'
import { createStore } from './shared/store'
import { resolveWebQQColorMode } from './webqq/utils/webqq-color-mode'

export type { CapsuleSnapshot, OneBotRobotProfile, OneBotRobotState }

type Endpoint = keyof ConsoleRequests
type InputOf<K extends Endpoint> = Parameters<ConsoleRequests[K]>[0]
type OutputOf<K extends Endpoint> = Awaited<ReturnType<ConsoleRequests[K]>>

/** 契约的统一调用口：错误只保留服务端给出的第一行说明，不带错误码前缀。 */
export async function invoke<K extends Endpoint>(name: K, ...input: Parameters<ConsoleRequests[K]>): Promise<OutputOf<K>> {
  try {
    // 无参端点的入参是 undefined，action 请求体仍需一个对象。
    const body: InputOf<K> | object = input[0] ?? {}
    return await callAction(name, body as never) as OutputOf<K>
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
    throw new Error(message.trim().split(/\r?\n/, 1)[0]?.replace(/^[A-Z_]+[:：]\s*/, '') || message)
  }
}

/** 服务端下发的镜像配置。订阅到第一份运行状态之前用配置规格的默认值。 */
export const config = createStore<MirroredConfigValues>(readMirroredConfigValues(undefined))
export const capsule = createStore<CapsuleSnapshot | undefined>(undefined)
export const availableBots = createStore<OneBotRobotProfile[]>([])
export const selectedBotSelfId = createStore('')
/** 插件本次启动的时刻；变化说明插件按新配置重启过。 */
export const runtimeStartedAt = createStore(0)

/** 观察窗是否打开、小胶囊被拖到的位置与 WebQQ 总未读数：小胶囊与观察窗两个组件共享的会话态。 */
export const webQQOpen = createStore(false)
export const capsuleAnchor = createStore<CapsuleAnchor | undefined>(undefined)
export const webQQTotalUnread = createStore(0)

/** v2 宿主的明暗：外壳在 `<html>` 上切换 `dark` 类。 */
export const hostColorMode = createStore<'light' | 'dark'>('light')

export function resolvedColorMode() {
  return resolveWebQQColorMode(config.get().webQQColorMode, hostColorMode.get())
}

export function applyBotState(state: Partial<OneBotRobotState>) {
  availableBots.set(state.bots ?? [])
  selectedBotSelfId.set(state.selectedSelfId || '')
}

export async function selectWebQQBot(selfId: string) {
  return invoke('onebot-webqq.bot.select', { selfId })
}

type EventListener = (event: WebQQEvent) => void
const eventListeners = new Set<EventListener>()

/** 订阅实时消息与撤回。观察窗挂载期间登记，卸载时撤销。 */
export function onWebQQEvent(listener: EventListener) {
  eventListeners.add(listener)
  return () => {
    eventListeners.delete(listener)
  }
}

/**
 * 接上服务端的两个 state。事件流是追加型数组：首个快照里的旧事件只用来对齐游标，不重放；
 * 之后按 `seq` 只处理比游标新的，重连后快照里漏收的那几条照常补上。
 */
export function connectRuntime() {
  const observer = new MutationObserver(() => {
    hostColorMode.set(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  hostColorMode.set(document.documentElement.classList.contains('dark') ? 'dark' : 'light')

  const offRuntime = subscribeLive(RUNTIME_STATE, undefined, (snapshot) => {
    const data = snapshot.data
    if (!data) return
    runtimeStartedAt.set(data.startedAt)
    config.set({ ...readMirroredConfigValues(undefined), ...data.config })
    capsule.set(data.capsule)
    applyBotState(data)
  })

  let cursor: number | undefined
  const offEvents = subscribeLive(EVENTS_STATE, undefined, (snapshot) => {
    const events = snapshot.data
    if (!events) return
    if (cursor === undefined) {
      cursor = events.at(-1)?.seq ?? 0
      return
    }
    for (const event of events) {
      if (event.seq <= cursor) continue
      cursor = event.seq
      for (const listener of [...eventListeners]) listener(event)
    }
  })

  return () => {
    observer.disconnect()
    offRuntime()
    offEvents()
    capsule.set(undefined)
    webQQOpen.set(false)
    webQQTotalUnread.set(0)
  }
}
