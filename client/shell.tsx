import { Capsule } from './capsule/capsule'
import { useStore } from './shared/store'
import { webQQOpen } from './runtime'
import { WebQQObserver } from './webqq/observer'

export function WebQQShell() {
  const open = useStore(webQQOpen)
  return (
    <Capsule>
      <WebQQObserver visible={open} />
    </Capsule>
  )
}
