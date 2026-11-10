import type { Context } from 'cordis'
import type {} from '@chatluna/ui-server'
import { ApiError } from '@chatluna/server'
import {
  EVENTS_STATE,
  RUNTIME_STATE,
  type ConsoleRequests,
  type WebQQEvent,
  type WebQQRuntimeState,
} from './shared/console-contract'
import { errorDetail } from './shared/error-detail'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type WebQQActionHandler<K extends keyof ConsoleRequests> = (
  ...input: Parameters<ConsoleRequests[K]>
) => ReturnType<ConsoleRequests[K]>

/** 事件快照里保留的条数：断线重连后补发这么多条，足够覆盖短暂掉线。 */
const EVENT_BUFFER = 50

/**
 * 把 WebUI 契约接到 `chatluna_webui`：端点注册为 action，小胶囊与配置折叠成一个运行状态 state，
 * 实时消息与撤回经追加型 state 推送。
 */
export function createWebuiBridge(ctx: Context, readRuntime: () => Omit<WebQQRuntimeState, 'startedAt'>) {
  const startedAt = Date.now()
  const events: WebQQEvent[] = []
  // 事件序号从启动时刻起算，插件重启后仍然单调递增，客户端不会把新事件当成已处理过的旧事件。
  let seq = startedAt

  ctx.chatluna_webui.state(RUNTIME_STATE, { get: () => ({ startedAt, ...readRuntime() }) })
  ctx.chatluna_webui.state(EVENTS_STATE, { get: () => events })

  return {
    addEntry() {
      ctx.chatluna_webui.addEntry({
        baseUrl: import.meta.url,
        source: '../client/index.ts',
        bundle: '../dist/client.js',
      })
    },

    refreshRuntime() {
      ctx.chatluna_webui.refresh(RUNTIME_STATE)
    },

    emit(event: DistributiveOmit<WebQQEvent, 'seq'>) {
      const item = { ...event, seq: ++seq } as WebQQEvent
      events.push(item)
      if (events.length > EVENT_BUFFER) events.splice(0, events.length - EVENT_BUFFER)
      ctx.chatluna_webui.append(EVENTS_STATE, [item])
    },

    action<K extends keyof ConsoleRequests>(name: K, handler: WebQQActionHandler<K>) {
      // OneBot 返回的错误是调用方可以理解、无需服务端堆栈的业务失败，统一映射成 400，
      // 界面原样显示第一行说明。其余异常保持 500，并在服务端记下堆栈。
      const wrapped = async (input: unknown) => {
        try {
          return await Reflect.apply(handler, undefined, [input ?? undefined])
        } catch (error) {
          if (error instanceof ApiError) throw error
          if (error instanceof Error && error.constructor === Error) throw new ApiError('INVALID_ARGUMENT', error.message)
          ctx.logger.warn('%s failed\n%s', name, errorDetail(error))
          throw error
        }
      }
      // 契约逐端点的签名已由 handler 的类型约束；这里只做错误映射，统一以宽签名登记。
      ctx.chatluna_webui.action(name, {}, wrapped as never)
    },
  }
}

export type WebuiBridge = ReturnType<typeof createWebuiBridge>
