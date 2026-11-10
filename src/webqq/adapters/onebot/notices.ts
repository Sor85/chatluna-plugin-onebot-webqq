import type { WebQQNotice } from '../../types'
import {
  getBooleanField,
  getStringField,
  isRecord,
  toArrayResult,
  toTimestampMs,
} from '../../../onebot/data'
import { resolveWebQQGroupAvatar, type WebQQAvatarScope } from '../../display'
import { oneBotAvatarFields } from './contacts'

function isHandledGroupNotice(raw: unknown) {
  if (!isRecord(raw)) return false
  const checked = raw.checked
  return checked === true || checked === 1 || checked === 'true'
}

function normalizeGroupRequestSubType(value: string, bucket: string) {
  const normalizedBucket = bucket.toLowerCase()
  if (value === 'leave' || value === 'decrease' || value === 'quit' || normalizedBucket.includes('leave') || normalizedBucket.includes('decrease')) return 'leave'
  if (value === 'invite' || value === 'invited') return 'invite'
  if (value === 'add' || value === 'join') return 'add'
  return normalizedBucket.includes('invited') ? 'invite' : 'add'
}

function getGroupNoticeStatus(item: Record<string, unknown>): WebQQNotice['status'] {
  if (!isHandledGroupNotice(item)) return 'pending'
  const approved = getBooleanField(item, ['approved', 'approve', 'accepted'])
  return approved === false ? 'rejected' : 'approved'
}

function normalizeGroupNotice(raw: unknown, bucket: string, index: number, scope: WebQQAvatarScope): WebQQNotice {
  const item = isRecord(raw) ? raw : {}
  const requestId = getStringField(item, ['request_id', 'requestId', 'notice_id', 'noticeId', 'flag', 'seq', 'id']) || String(index)
  const groupId = getStringField(item, ['group_id', 'groupId', 'group_code', 'groupCode'])
  const groupName = getStringField(item, ['group_name', 'groupName']) || groupId
  const requesterId = getStringField(item, ['requester_uin', 'requester_id', 'requesterId', 'user_id', 'userId', 'member_uin', 'memberUin', 'uin'])
  const requesterName = getStringField(item, ['requester_nick', 'requesterNick', 'nickname', 'nick', 'user_name', 'name']) || requesterId
  const comment = getStringField(item, ['message', 'comment', 'reason'])
  const subType = normalizeGroupRequestSubType(getStringField(item, ['sub_type', 'subType', 'request_type', 'type']), bucket)
  const actionText = subType === 'leave'
    ? '退出群聊'
    : subType === 'invite'
      ? '邀请入群'
      : '申请加入群聊'
  return {
    id: subType === 'leave' ? `group:leave:${requestId}` : `group:${requestId}`,
    type: 'group-notice',
    title: groupName || '群通知',
    subtitle: requesterName ? `${requesterName} ${actionText}` : actionText,
    avatar: groupId ? resolveWebQQGroupAvatar(getStringField(item, oneBotAvatarFields), groupId, scope) : '',
    status: subType === 'leave' ? 'approved' : getGroupNoticeStatus(item),
    time: toTimestampMs(getStringField(item, ['time', 'timestamp', 'request_time', 'requestTime', 'create_time', 'createTime'])),
    subType,
    ...(subType !== 'leave' ? { flag: requestId } : {}),
    ...(groupId ? { groupId } : {}),
    ...(groupName ? { groupName } : {}),
    ...(requesterId ? { requesterId } : {}),
    ...(requesterName ? { requesterName } : {}),
    ...(comment ? { comment } : {}),
  }
}

export function normalizeGroupNotices(result: unknown, scope: WebQQAvatarScope) {
  // SnowLuma 把加群与邀请申请混在一个裸数组里，不分桶；按桶名遍历会把每条读九遍。
  // 它的 flag 是可直接回传的规范串，request_id 只是序号；有 invitor_uin 的是邀请。
  const payload = isRecord(result) && 'data' in result ? result.data : result
  if (Array.isArray(payload)) {
    return payload.map((item, index) => {
      const invited = isRecord(item) && Number(item.invitor_uin) > 0
      const flag = isRecord(item) ? getStringField(item, ['flag']) : ''
      return normalizeGroupNotice(isRecord(item) && flag ? { ...item, request_id: flag } : item, invited ? 'invited_requests' : 'join_requests', index, scope)
    })
  }
  const notices: WebQQNotice[] = []
  for (const bucket of ['join_requests', 'JoinRequest', 'invited_requests', 'InvitedRequest', 'requests', 'notices', 'leave_notices', 'leave_notifications', 'decrease_notices']) {
    const items = toArrayResult(result, bucket)
    items.forEach((item, index) => {
      notices.push(normalizeGroupNotice(item, bucket, index, scope))
    })
  }
  return notices
}
