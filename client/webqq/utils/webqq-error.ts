// Koishi 控制台 RPC 失败时，服务端在 Client.receive 里用 coerce() 把异常序列化成
// 「Error: 原因\n    at ...」这样的纯字符串，客户端 send() 再以该字符串 reject。
// 因此这里绝不能只判断 `error instanceof Error`：对所有服务端错误来说该判断永远为 false，
// 真实原因会被 fallback 文案整体吞掉，页面上只剩「加载聊天历史失败」这类无法排查的提示。
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

// 从服务端返回的堆栈字符串里取出可读的首行原因，并去掉 `Error: ` 前缀。
export function readWebQQErrorMessage(error: unknown, fallback: string) {
  const text = readWebQQErrorText(error)
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
  const message = firstLine.replace(errorNamePattern, '').trim()
  // send() 的 60 秒超时只会给出 'timeout'，直接暴露对用户没有意义。
  if (message === 'timeout') return `${fallback}：服务端 60 秒内没有响应`
  return message || fallback
}
