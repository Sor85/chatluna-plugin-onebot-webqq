/** 调试日志的最小形状：插件只在 `debug` 开启时传入 `ctx.logger`，各模块可选地写诊断信息。 */
export interface DebugLogger {
  info(format: string, ...param: unknown[]): unknown
}
