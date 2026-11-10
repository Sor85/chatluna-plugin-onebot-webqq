import type { Context } from 'cordis'
import { registerReactFormExtension } from '@chatluna/ui-schema-form/client'
import zh from './locales/zh.yml'
import en from './locales/en.yml'
import { connectRuntime } from './runtime'
import { WebQQShell } from './shell'
import { RouteSelect } from './route-select'
import './styles/index.css'

export default function apply(ctx: Context) {
  ctx.locale.register('onebot-webqq', { zh, en })
  ctx.effect(() => connectRuntime())
  ctx.effect(() => registerReactFormExtension({
    type: 'array',
    role: 'onebot-webqq:route-select',
    component: RouteSelect,
    priority: 30,
  }))
  // 小胶囊与观察窗挂在全局 overlay 插槽：登录后在每个页面常驻，观察窗关着也接收实时消息、累计未读数。
  ctx.slots.overlay({ id: 'onebot-webqq', component: WebQQShell })
}
