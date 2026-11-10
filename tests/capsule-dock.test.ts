import { describe, expect, it } from 'vitest'
import {
  CAPSULE_ANCHOR_VIEWPORT_MARGIN as margin,
  clampCapsuleAnchor,
  normalizeCapsuleAnchorPosition,
  resolveCapsuleDock,
} from '../client/capsule/capsule-anchor'

const viewport = { width: 1000, height: 800 }
const size = { width: 204, height: 50 }

describe('小胶囊贴边', () => {
  it('停在边距上不贴边，继续往外推满一个边距才贴边', () => {
    expect(resolveCapsuleDock({ right: margin, width: 204 }, viewport)).toBeUndefined()
    expect(resolveCapsuleDock({ right: 0, width: 204 }, viewport)).toBe('right')
    expect(resolveCapsuleDock({ right: viewport.width - 204 - margin, width: 204 }, viewport)).toBeUndefined()
    expect(resolveCapsuleDock({ right: viewport.width - 204, width: 204 }, viewport)).toBe('left')
  })

  it('已贴边时沿边拖动保留贴边，往内拖离边距即取消', () => {
    expect(resolveCapsuleDock({ right: margin, width: 204 }, viewport, 'right')).toBe('right')
    expect(resolveCapsuleDock({ right: margin + 1, width: 204 }, viewport, 'right')).toBeUndefined()
    expect(resolveCapsuleDock({ right: viewport.width - 204 - margin, width: 204 }, viewport, 'left')).toBe('left')
  })

  it('贴边锚点随视口宽度跟住所在一侧', () => {
    expect(clampCapsuleAnchor({ ...size, right: 300, bottom: 60, dock: 'right' }, viewport).right).toBe(margin)
    expect(clampCapsuleAnchor({ ...size, right: 300, bottom: 60, dock: 'left' }, { width: 1400, height: 800 }).right)
      .toBe(1400 - 204 - margin)
  })

  it('存储只接受合法的贴边方向', () => {
    expect(normalizeCapsuleAnchorPosition({ right: 8, bottom: 60, dock: 'left' })).toEqual({ right: 8, bottom: 60, dock: 'left' })
    expect(normalizeCapsuleAnchorPosition({ right: 8, bottom: 60, dock: 'top' })).toEqual({ right: 8, bottom: 60 })
  })
})
