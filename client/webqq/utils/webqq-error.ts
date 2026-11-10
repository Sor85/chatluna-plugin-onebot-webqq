// 控制台请求失败与本地异常都可能带「Error: 原因\n    at ...」这样的堆栈文本，
// 也可能是纯字符串；这里统一取出可读原因，取不到时才用 fallback 文案。
const errorNamePattern = /^[\w$.]*Error:\s*/

function readWebQQErrorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const message = Reflect.get(error, 'message')
    if (typeof message === 'string') return message
  }
  return ''
}

// 取出可读的首行原因，并去掉 `Error: ` 前缀。
export function readWebQQErrorMessage(error: unknown, fallback: string) {
  const text = readWebQQErrorText(error)
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
  const message = firstLine.replace(errorNamePattern, '').trim()
  return message || fallback
}
