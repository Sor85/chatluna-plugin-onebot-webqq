/** 取出文本里全部 `<think>` 元素的内容，多段之间空一行。 */
export function parseThinkContent(text: string) {
  return Array.from(text.matchAll(/<think\b[^>]*>([\s\S]*?)<\/think\s*>/gi))
    .map((match) => (match[1] ?? '').trim())
    .filter(Boolean)
    .join('\n\n')
}
