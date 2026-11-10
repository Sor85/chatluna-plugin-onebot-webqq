import Schema from 'schemastery'
import { pathOf, resolveSlotLabel, routeExtraView, useSlot } from '@chatluna/ui-client/client'
import type { SchemaRendererProps } from '@chatluna/ui-schema-form/client'

/**
 * 「隐藏小胶囊的页面」的表单控件：候选项是侧边栏里当前注册的页面，值是不带参数的路由路径。
 * 只负责生成候选项，渲染交回 v2 表单自带的多选控件，外观与其他多选字段一致；已选但当前没有注册的
 * 页面（插件停用了）照样列出，免得多选控件把它悄悄丢掉。
 */
export function RouteSelect(props: SchemaRendererProps) {
  const routes = useSlot('route')
  const selected: unknown[] = Array.isArray(props.value) ? props.value : []
  const choices = new Map<string, string>()
  for (const route of routes) {
    if (!route.id || routeExtraView(route.extra).hidden) continue
    const path = pathOf(route.id)
    if (path && path !== '/' && !choices.has(path)) choices.set(path, resolveSlotLabel(route.label) ?? path)
  }
  for (const value of selected) {
    if (typeof value === 'string' && !choices.has(value)) choices.set(value, value)
  }
  const schema = Schema.array(Schema.union([...choices].map(([path, label]) => Schema.const(path).description(`${label}（${path}）`))))
  Object.assign(schema.meta, props.schema.meta, { role: 'select' })
  return props.render(schema, props.value, props.path, props.onChange)
}
