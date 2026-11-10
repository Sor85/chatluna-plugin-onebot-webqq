import * as React from 'react'

type Phase = 'idle' | 'enter-from' | 'enter-active' | 'leave-from' | 'leave-active' | 'unmounted'

function classesOf(name: string, phase: Phase) {
  switch (phase) {
    case 'enter-from': return `${name}-enter-from ${name}-enter-active`
    case 'enter-active': return `${name}-enter-active ${name}-enter-to`
    case 'leave-from': return `${name}-leave-from ${name}-leave-active`
    case 'leave-active': return `${name}-leave-active ${name}-leave-to`
    default: return ''
  }
}

/** 元素上声明的过渡与动画里最长的一段，作为过渡结束的兜底计时。 */
function longestDuration(element: Element) {
  const style = getComputedStyle(element)
  const parse = (value: string) => value.split(',').map((item) => Number.parseFloat(item) * (item.trim().endsWith('ms') ? 1 : 1000) || 0)
  const total = (durations: string, delays: string) => {
    const d = parse(durations)
    const l = parse(delays)
    return Math.max(0, ...d.map((value, index) => value + (l[index % l.length] ?? 0)))
  }
  return Math.max(total(style.transitionDuration, style.transitionDelay), total(style.animationDuration, style.animationDelay))
}

/**
 * Vue `<Transition name>` 的 React 版：进出场时给唯一的子元素依次挂上 `${name}-enter-from/active/to`
 * 与 `${name}-leave-from/active/to`，样式表里的过渡规则原样生效；离场过渡结束后才卸载子元素。
 * 与 Vue 一致，首次渲染不播进场。
 */
export function CssTransition(props: {
  name: string
  show: boolean
  children: React.ReactElement<{ className?: string, ref?: React.Ref<HTMLElement> }>
  onBeforeLeave?: (element: HTMLElement) => void
}) {
  const { name, show, onBeforeLeave } = props
  const [phase, setPhase] = React.useState<Phase>(show ? 'idle' : 'unmounted')
  const [child, setChild] = React.useState(props.children)
  const element = React.useRef<HTMLElement>(null)
  const first = React.useRef(true)

  if (show && child !== props.children) setChild(props.children)

  React.useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (show) {
      setPhase('enter-from')
      return
    }
    if (element.current) onBeforeLeave?.(element.current)
    setPhase((current) => current === 'unmounted' ? current : 'leave-from')
  }, [show])

  React.useEffect(() => {
    if (phase !== 'enter-from' && phase !== 'leave-from') return
    const node = element.current
    if (!node) {
      setPhase(phase === 'enter-from' ? 'idle' : 'unmounted')
      return
    }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPhase(phase === 'enter-from' ? 'enter-active' : 'leave-active'))
    })
    return () => cancelAnimationFrame(frame)
  }, [phase])

  React.useEffect(() => {
    if (phase !== 'enter-active' && phase !== 'leave-active') return
    const node = element.current
    const done = () => setPhase(phase === 'enter-active' ? 'idle' : 'unmounted')
    if (!node) return done()
    const timer = setTimeout(done, longestDuration(node) + 50)
    const onEnd = (event: Event) => {
      if (event.target !== node) return
      clearTimeout(timer)
      done()
    }
    node.addEventListener('transitionend', onEnd)
    node.addEventListener('animationend', onEnd)
    return () => {
      clearTimeout(timer)
      node.removeEventListener('transitionend', onEnd)
      node.removeEventListener('animationend', onEnd)
    }
  }, [phase])

  if (phase === 'unmounted') return null
  const rendered = show ? props.children : child
  const extra = classesOf(name, phase)
  const childRef = rendered.props.ref
  return React.cloneElement(rendered, {
    ref: (node: HTMLElement | null) => {
      element.current = node
      if (typeof childRef === 'function') childRef(node)
      else if (childRef) (childRef as React.RefObject<HTMLElement | null>).current = node
    },
    className: [rendered.props.className, extra].filter(Boolean).join(' '),
  })
}
