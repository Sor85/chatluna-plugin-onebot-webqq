import type { WebQQMessage, WebQQRecallPayload } from '../types'
import { mergeMessages } from './webqq-message-view'

function isRecallTarget(message: WebQQMessage, messageId: string) {
  return message.id === messageId || message.sequence === messageId
}

export function applyWebQQRecallToMessages(messages: WebQQMessage[], payload: WebQQRecallPayload) {
  if (payload.mode === 'mark') {
    return messages.map((message) => isRecallTarget(message, payload.messageId)
      ? { ...message, recalled: true }
      : message)
  }
  const nextMessages = messages.filter((message) => !isRecallTarget(message, payload.messageId))
  return payload.eventMessage
    ? mergeMessages(nextMessages, [payload.eventMessage])
    : nextMessages
}
