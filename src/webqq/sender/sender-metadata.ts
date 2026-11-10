import type { WebQQMessage } from '../types'
import { readRecordText } from '../../shared/record'
import { normalizeWebQQGroupRole } from '../display'

export interface WebQQSenderMetadata {
  senderRole?: string
  senderLevel?: string
  senderTitle?: string
}

const senderMetadataTargets = ['senderRole', 'senderLevel', 'senderTitle'] as const
const senderMetadataFields = [
  { target: 'senderLevel' as const, keys: ['level', 'sender_level', 'senderLevel'] },
  { target: 'senderTitle' as const, keys: ['title', 'special_title', 'specialTitle'] },
]

export function readWebQQSenderMetadata(source: unknown): WebQQSenderMetadata {
  const role = normalizeWebQQGroupRole(readRecordText(source, ['role']))
  const metadata: WebQQSenderMetadata = role ? { senderRole: role } : {}
  for (const field of senderMetadataFields) {
    const value = readRecordText(source, field.keys)
    if (value) metadata[field.target] = value
  }
  return metadata
}

export function hasWebQQSenderMetadata(metadata: WebQQSenderMetadata) {
  return senderMetadataTargets.some((target) => !!metadata[target])
}

export function readWebQQMessageSenderMetadata(message: WebQQMessage): WebQQSenderMetadata {
  const metadata: WebQQSenderMetadata = {}
  for (const target of senderMetadataTargets) {
    if (message[target]) metadata[target] = message[target]
  }
  return metadata
}

export function isSameWebQQSenderMetadata(left: WebQQSenderMetadata | undefined, right: WebQQSenderMetadata) {
  return !!left && senderMetadataTargets.every((target) => left[target] === right[target])
}

export function fillWebQQMessageSenderMetadata(message: WebQQMessage, metadata?: WebQQSenderMetadata) {
  if (!metadata) return message
  const next = { ...message }
  if (!next.senderRole && metadata.senderRole) next.senderRole = metadata.senderRole
  for (const field of senderMetadataFields) {
    if (!next[field.target] && metadata[field.target]) next[field.target] = metadata[field.target]
  }
  return next
}

export function replaceWebQQMessageSenderMetadata(message: WebQQMessage, metadata: WebQQSenderMetadata) {
  const next = { ...message }
  for (const target of senderMetadataTargets) delete next[target]
  return {
    ...next,
    ...metadata,
  }
}
