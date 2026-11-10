function getInlineRuns(bubble: HTMLElement) {
  return [...bubble.querySelectorAll<HTMLElement>('.onebot-webqq-webqq__inline-run')]
}

function readPixelValue(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function readRectValue(value: number) {
  return Number.isFinite(value) ? value : 0
}

type RenderedContentRect = {
  top: number
  left: number
  right: number
  width: number
}

type RenderedLineRect = {
  top: number
  left: number
  right: number
}

const lineTopTolerance = 2

function getRenderedContentRects(node: HTMLElement): RenderedContentRect[] {
  const range = document.createRange()
  range.selectNodeContents(node)
  try {
    const rangeRects = [...range.getClientRects()]
    const imageRects = typeof node.querySelectorAll === 'function'
      ? [...node.querySelectorAll<HTMLImageElement>('img')].map((image) => image.getBoundingClientRect())
      : []
    return [...rangeRects, ...imageRects]
      .map((rect) => {
        const width = readRectValue(rect.width)
        const left = readRectValue(rect.left)
        const right = readRectValue(rect.right) || left + width
        return {
          top: readRectValue(rect.top),
          left,
          right,
          width,
        }
      })
      .filter((rect) => rect.width > 0)
  } finally {
    range.detach()
  }
}

function getBubbleBoxInset(bubble: HTMLElement) {
  const computedStyle = typeof window === 'undefined' ? undefined : window.getComputedStyle(bubble)
  if (!computedStyle || computedStyle.boxSizing !== 'border-box') return 0
  return (
    readPixelValue(computedStyle.paddingLeft) +
    readPixelValue(computedStyle.paddingRight) +
    readPixelValue(computedStyle.borderLeftWidth) +
    readPixelValue(computedStyle.borderRightWidth)
  )
}

function getMaxLineWidth(widths: number[]) {
  return widths.reduce((width, item) => Math.max(width, item), 0)
}

function setBubbleContentWidth(bubble: HTMLElement, contentWidth: number, horizontalInset: number) {
  bubble.style.width = `${Math.ceil(contentWidth + horizontalInset)}px`
}

function findMatchingLine(lines: RenderedLineRect[], top: number) {
  return lines.find((line) => Math.abs(line.top - top) <= lineTopTolerance)
}

function mergeRenderedLineRects(rects: RenderedContentRect[]) {
  const lines: RenderedLineRect[] = []
  for (const rect of rects) {
    const line = findMatchingLine(lines, rect.top)
    if (line) {
      line.left = Math.min(line.left, rect.left)
      line.right = Math.max(line.right, rect.right)
      continue
    }
    lines.push({ top: rect.top, left: rect.left, right: rect.right })
  }
  return lines.map((line) => Math.max(0, line.right - line.left))
}

function measureInlineLineWidths(inlineRuns: HTMLElement[]) {
  // Range 会在 @ 提及或相邻行内节点边界把同一视觉行拆成多个 rect；
  // 先按行合并可以避免只取到最长片段，导致本应一行的消息被压窄换行。
  return mergeRenderedLineRects(inlineRuns.flatMap(getRenderedContentRects))
}

function measureReactionWidth(bubble: HTMLElement) {
  if (typeof bubble.querySelector !== 'function') return 0
  const reactions = bubble.querySelector<HTMLElement>('.onebot-webqq-webqq__message-reactions')
  return reactions ? readRectValue(reactions.getBoundingClientRect().width) : 0
}

export function fitWebQQBubbleToInlineLines(bubble: HTMLElement) {
  const inlineRuns = getInlineRuns(bubble)
  if (!inlineRuns.length) {
    bubble.style.width = ''
    return
  }

  bubble.style.width = ''
  const horizontalInset = getBubbleBoxInset(bubble)
  const lineWidths = measureInlineLineWidths(inlineRuns)
  const maxLineWidth = getMaxLineWidth(lineWidths)
  const reactionWidth = measureReactionWidth(bubble)
  const contentWidth = Math.max(maxLineWidth, reactionWidth)
  if (!contentWidth) return

  // chatluna-sandbox 依靠 reaction 的固有宽度撑开 column flex 气泡；这里的纯文本拟合会写死 width，
  // 因此必须把 reaction 宽度纳入同一次测量，避免短文本把贴表情胶囊挤出消息气泡。
  setBubbleContentWidth(bubble, contentWidth, horizontalInset)
}
