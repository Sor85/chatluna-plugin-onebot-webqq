import { callAction, callSupportedAction, type OneBotBot } from '../actions'
import { getActionData, getStringField, isRecord, toOneBotId } from '../data'
import type { WebQQProtocol } from '../protocol'
import { assertSafeOneBotMediaFile } from './images'

function resolveRecordUrl(result: unknown, mediaUrlResolver?: (file: string) => string) {
  const source = getActionData(result)
  const url = getStringField(source, ['url', 'temp_url', 'src'])
  if (url) return mediaUrlResolver?.(url) || url
  const file = getStringField(source, ['file', 'path'])
  return file ? mediaUrlResolver?.(file) || file : ''
}

function readRecordDebug(result: unknown) {
  const source = getActionData(result)
  return {
    url: getStringField(source, ['url', 'temp_url', 'src']),
    file: getStringField(source, ['file', 'path']),
  }
}

export async function resolveOneBotRecord(bot: OneBotBot, file: string, mediaUrlResolver?: (file: string) => string) {
  // OneBot 的 record 文件常是 silk/amr；请求 mp3 可以让浏览器端 audio 更稳定地播放。
  assertSafeOneBotMediaFile(file)
  const result = await callAction(bot, 'get_record', { file, out_format: 'mp3' })
  return {
    url: resolveRecordUrl(result, mediaUrlResolver),
    debug: readRecordDebug(result),
  }
}

// 语音转文字在两种实现里是两个 action 名：NapCat 只有 fetch_ptt_text，LLBot 只有 voice_msg_to_text。
// 按配置的协议把更可能命中的排在前面，协议配错时仍能靠另一个名字兜住，两者的返回都是 `{ text }`。
// SnowLuma 只有 fetch_ptt_text（另两个名字是同一个处理器）；重试会让 QQ 重新识别并顶掉进行中的那次，所以不试别名。
function getRecordTranscriptionActions(protocol?: WebQQProtocol) {
  if (protocol === 'snowluma') return ['fetch_ptt_text']
  return protocol === 'llbot'
    ? ['voice_msg_to_text', 'fetch_ptt_text']
    : ['fetch_ptt_text', 'voice_msg_to_text']
}

export async function transcribeOneBotRecord(bot: OneBotBot, messageId: string, protocol?: WebQQProtocol) {
  const result = await callSupportedAction(bot, getRecordTranscriptionActions(protocol), {
    message_id: toOneBotId(messageId),
  })
  if (typeof result === 'string') return result
  const source = isRecord(result) ? getActionData(result) : {}
  return getStringField(source, ['text']) || ''
}
