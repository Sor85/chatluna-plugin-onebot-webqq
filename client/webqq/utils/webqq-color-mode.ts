import type { WebQQColorMode } from '../../../src/config/spec'

export function resolveWebQQColorMode(
  mode: WebQQColorMode,
  inheritedMode: 'light' | 'dark',
): 'light' | 'dark' {
  return mode === 'auto' ? inheritedMode : mode
}
