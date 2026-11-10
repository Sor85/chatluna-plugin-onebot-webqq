import type { WebQQMessageElement } from '../../types'
import type { OneBotBot } from '../../../onebot/actions'
import { getStringField } from '../../../onebot/data'
import { resolveOneBotImage } from '../../../onebot/media/images'
import {
  isRemoteImageSource,
  isDirectMediaSource,
  isUnresolvableMediaSource,
  resolveWebQQMediaUrl,
} from '../../media/image-url-resolver'

// 没有可取回的地址时带上占位文案：界面对没有 url 的图片段走的是 `element.text` 那条分支，
// 缺了它混排消息会退回整条摘要，合并转发里会退成「[消息]」。
export const missingImageElement: WebQQMessageElement = { type: 'image', text: '[图片]' }

export async function normalizeImageElement(data: Record<string, unknown>, bot: OneBotBot, imageUrlResolver?: (file: string) => string): Promise<WebQQMessageElement> {
  // 取不回的 url 不算地址，继续按 file 解析：同一段里 file 可能是实现自己认得的文件 ID。
  const url = resolveWebQQMediaUrl(getStringField(data, ['url', 'src']), imageUrlResolver)
  if (url) return { type: 'image', url }
  const file = getStringField(data, ['file', 'file_id'])
  if (!file) return missingImageElement
  if (isRemoteImageSource(file) || isDirectMediaSource(file)) {
    return { type: 'image', url: resolveWebQQMediaUrl(file, imageUrlResolver) }
  }
  // get_image 只认文件 ID；带 scheme 的引用连 assertSafeOneBotMediaFile 都过不了，不必白跑一次 action。
  if (isUnresolvableMediaSource(file)) return missingImageElement
  try {
    return { type: 'image', url: (await resolveOneBotImage(bot, file, imageUrlResolver)).url }
  } catch {
    return missingImageElement
  }
}
