import { useSyncExternalStore } from 'react'

/**
 * 最小的可订阅值：WebQQ 的状态都在 React 树外（小胶囊与观察窗是 overlay 插槽里的两个组件，
 * 控制器还要被实时事件回调直接写），组件经 `useStore` 订阅，值按引用比较，没变就不重渲染。
 */
export interface Store<T> {
  get(): T
  set(value: T): void
  update(updater: (value: T) => T): void
  subscribe(listener: () => void): () => void
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const listener of [...listeners]) listener()
    },
    update(updater) {
      this.set(updater(value))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
