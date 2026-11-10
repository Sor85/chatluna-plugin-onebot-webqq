import * as React from 'react'
import { IconX } from '@tabler/icons-react'
import {
  Button,
  Input,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@chatluna/ui-kit'
import { useT } from '../i18n'
import { useStore } from '../shared/store'
import { config, hostColorMode } from '../runtime'
import { resolveWebQQColorMode } from './utils/webqq-color-mode'
import { useWebQQScrollbar } from './utils/webqq-scrollbar'

/** WebQQ 的明暗：插件设置为「自动」时跟随 v2 宿主主题。Portal 到 body 的浮层要显式挂上 `is-color-*`。 */
export function useResolvedColorMode() {
  const colorMode = useStore(config).webQQColorMode
  return resolveWebQQColorMode(colorMode, useStore(hostColorMode))
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export function WebQQButton(props: React.ComponentProps<typeof Button> & { variant?: 'default' | 'outline' | 'destructive' }) {
  const { className, variant = 'default', ...rest } = props
  return <Button {...rest} variant={variant} data-variant={variant} className={cn('webqq-ui-button', typeof className === 'string' ? className : undefined)} />
}

export function WebQQInput(props: React.ComponentProps<'input'>) {
  const { className, ...rest } = props
  return <Input {...rest} className={cn('webqq-ui-input', className)} />
}

export { Dialog as WebQQDialog }

/**
 * 弹窗内容：行为来自 ui-kit 的 Dialog（焦点圈定、Esc、点遮罩关闭、关闭后焦点回到触发处），
 * 外观沿用原插件的 `.webqq-dialog-content`。关闭按钮换成原插件那一枚。
 */
export function WebQQDialogContent(props: { className?: string, children: React.ReactNode, onClose: () => void } & Omit<React.ComponentProps<typeof DialogContent>, 'children' | 'className'>) {
  const { className, children, onClose, ...rest } = props
  const t = useT()
  const colorMode = useResolvedColorMode()
  const scrollbar = useWebQQScrollbar<HTMLDivElement>({ zIndex: 10202 })
  return (
    <DialogContent
      {...rest}
      ref={scrollbar}
      showCloseButton={false}
      data-onebot-webqq-surface=""
      className={cn('webqq-dialog-content', `is-color-${colorMode}`, className)}
    >
      {children}
      <button type="button" aria-label={t('webqq.common.close')} className="webqq-dialog-close" onClick={onClose}>
        <IconX size={18} aria-hidden="true" />
      </button>
    </DialogContent>
  )
}

export function WebQQDialogHeader(props: React.ComponentProps<'header'>) {
  return <header data-slot="dialog-header" {...props} className={cn('webqq-dialog-header', props.className)} />
}

export function WebQQDialogFooter(props: React.ComponentProps<'footer'>) {
  return <footer data-slot="dialog-footer" {...props} className={cn('webqq-dialog-footer', props.className)} />
}

export function WebQQDialogTitle(props: React.ComponentProps<typeof DialogTitle>) {
  return <DialogTitle {...props} className={cn('webqq-dialog-title', typeof props.className === 'string' ? props.className : undefined)} />
}

export function WebQQDialogDescription(props: React.ComponentProps<typeof DialogDescription>) {
  return <DialogDescription {...props} className={cn('webqq-dialog-description', typeof props.className === 'string' ? props.className : undefined)} />
}

export { ContextMenu as WebQQContextMenu, ContextMenuTrigger as WebQQContextMenuTrigger, ContextMenuSub as WebQQContextMenuSub }

export function WebQQContextMenuContent(props: React.ComponentProps<typeof ContextMenuContent>) {
  const colorMode = useResolvedColorMode()
  const { className, ...rest } = props
  return (
    <ContextMenuContent
      {...rest}
      data-onebot-webqq-surface=""
      className={cn('webqq-context-menu-content', `is-color-${colorMode}`, typeof className === 'string' ? className : undefined)}
    />
  )
}

export function WebQQContextMenuSubContent(props: React.ComponentProps<typeof ContextMenuContent>) {
  return <WebQQContextMenuContent {...props} className={cn('webqq-context-menu-sub-content', typeof props.className === 'string' ? props.className : undefined)} />
}

export function WebQQContextMenuItem(props: React.ComponentProps<typeof ContextMenuItem>) {
  const { className, ...rest } = props
  return <ContextMenuItem {...rest} className={cn('webqq-context-menu-item', typeof className === 'string' ? className : undefined)} />
}

export function WebQQContextMenuSubTrigger(props: React.ComponentProps<typeof ContextMenuSubTrigger>) {
  const { className, ...rest } = props
  return <ContextMenuSubTrigger {...rest} className={cn('webqq-context-menu-item webqq-context-menu-sub-trigger', typeof className === 'string' ? className : undefined)} />
}
