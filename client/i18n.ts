import * as React from 'react'
import { useLocale, useTranslate, type Translate } from '@chatluna/ui-client/client'

export const LOCALE_NS = 'onebot-webqq'

/**
 * 宿主按命名空间缓存 `t`，切换语言后引用不变，依赖它的 `useMemo`/`useCallback` 不会重算。
 * 这里按语言快照换一个新引用，把 `t` 写进依赖即可跟随切换。
 */
export function useT(): Translate {
  const locale = useLocale()
  const translate = useTranslate(LOCALE_NS)
  return React.useMemo<Translate>(() => (key, params) => translate(key, params), [translate, locale])
}

/**
 * React 树外（控制器、错误兜底）用的 `t`：观察窗根组件每次渲染登记当前语言的 `t`。
 */
let storeTranslate: Translate = (key) => key

export function bindStoreTranslator(t: Translate) {
  storeTranslate = t
}

export function tr(key: string, params?: Record<string, unknown>) {
  return storeTranslate(key, params)
}
