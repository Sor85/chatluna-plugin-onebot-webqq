import { invoke } from '../../runtime'
import { tr } from '../../i18n'
import type {
  WebQQContacts,
  WebQQForwardItem,
  WebQQForwardSendInput,
  WebQQFriend,
  WebQQFriendAction,
  WebQQFriendCategory,
  WebQQGroup,
  WebQQGroupAction,
  WebQQGroupAnnouncement,
  WebQQGroupInfo,
  WebQQGroupMember,
  WebQQMessage,
  WebQQMessageElement,
  WebQQMessageQuery,
  WebQQMessageSearchQuery,
  WebQQMessageSearchResult,
  WebQQMessageReaction,
  WebQQMessageReactionInput,
  WebQQMessageReactionUser,
  WebQQMessageRecallInput,
  WebQQNotice,
  WebQQProfile,
  WebQQProfileField,
  WebQQProfileQuery,
  WebQQRecentContact,
  WebQQSelfProfileUpdate,
  WebQQSendPayload,
} from '../types'
import type { HandleableWebQQNotice } from '../utils/webqq-notice-view'

const webQQContactsRetryLimit = 10
const webQQContactsRetryDelayMs = 800

function waitWebQQContactsRetry() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, webQQContactsRetryDelayMs)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function readStringField(source: Record<string, unknown>, key: string) {
  return readString(source[key])
}

function normalizeArray<T>(value: unknown, normalize: (item: unknown) => T | undefined) {
  if (!Array.isArray(value)) return []
  return value.map(normalize).filter((item): item is T => item !== undefined)
}

function readMessageDirection(value: unknown): WebQQMessage['direction'] | undefined {
  if (value === 'incoming') return 'incoming'
  if (value === 'outgoing') return 'outgoing'
  return undefined
}

function readNoticeType(value: unknown): WebQQNotice['type'] | undefined {
  if (value === 'friend-request') return 'friend-request'
  if (value === 'group-notice') return 'group-notice'
  return undefined
}

function readNoticeStatus(value: unknown): WebQQNotice['status'] | undefined {
  if (value === 'pending') return 'pending'
  if (value === 'approved') return 'approved'
  if (value === 'rejected') return 'rejected'
  return undefined
}

function readEventType(value: unknown): NonNullable<WebQQMessage['event']>['type'] | undefined {
  if (value === 'recall') return 'recall'
  if (value === 'poke') return 'poke'
  if (value === 'mute') return 'mute'
  if (value === 'reaction') return 'reaction'
  return undefined
}

function readElementType(value: unknown): WebQQMessageElement['type'] | undefined {
  if (value === 'text') return 'text'
  if (value === 'image') return 'image'
  if (value === 'quote') return 'quote'
  if (value === 'forward') return 'forward'
  if (value === 'card') return 'card'
  if (value === 'face') return 'face'
  if (value === 'file') return 'file'
  if (value === 'record') return 'record'
  if (value === 'video') return 'video'
  if (value === 'unknown') return 'unknown'
  return undefined
}

function normalizeWebQQForwardItem(value: unknown): WebQQForwardItem | undefined {
  if (!isRecord(value)) return
  const elements = normalizeArray(value.elements, normalizeWebQQMessageElement)
  return {
    ...(readStringField(value, 'title') != null ? { title: readStringField(value, 'title') } : {}),
    ...(readStringField(value, 'senderId') != null ? { senderId: readStringField(value, 'senderId') } : {}),
    ...(readStringField(value, 'senderAvatar') != null ? { senderAvatar: readStringField(value, 'senderAvatar') } : {}),
    elements,
  }
}

function normalizeWebQQMessageElement(value: unknown): WebQQMessageElement | undefined {
  if (!isRecord(value)) return
  const type = readElementType(value.type)
  if (!type) return
  const element: WebQQMessageElement = { type }
  const title = readStringField(value, 'title')
  const text = readStringField(value, 'text')
  const targetMessageId = readStringField(value, 'targetMessageId')
  const duration = readNumber(value.duration)
  const transcript = readStringField(value, 'transcript')
  const url = readStringField(value, 'url')
  const emojiUrl = readStringField(value, 'emojiUrl')
  const imageUrl = readStringField(value, 'imageUrl')
  const source = readStringField(value, 'source')
  const items = normalizeArray(value.items, normalizeWebQQForwardItem)
  if (title != null) element.title = title
  if (text != null) element.text = text
  if (targetMessageId != null) element.targetMessageId = targetMessageId
  if (duration != null) element.duration = duration
  if (transcript != null) element.transcript = transcript
  if (url != null) element.url = url
  if (emojiUrl != null) element.emojiUrl = emojiUrl
  if (imageUrl != null) element.imageUrl = imageUrl
  if (source != null) element.source = source
  if (items.length) element.items = items
  return element
}

function normalizeWebQQReactionUser(value: unknown): WebQQMessageReactionUser | undefined {
  if (!isRecord(value)) return
  const userId = readStringField(value, 'userId')
  const userAvatar = readStringField(value, 'userAvatar')
  if (userId == null || userAvatar == null) return
  return {
    userId,
    ...(readStringField(value, 'userName') != null ? { userName: readStringField(value, 'userName') } : {}),
    userAvatar,
  }
}

function normalizeWebQQReaction(value: unknown): WebQQMessageReaction | undefined {
  if (!isRecord(value)) return
  const emojiId = readStringField(value, 'emojiId')
  const label = readStringField(value, 'label')
  const count = readNumber(value.count)
  if (emojiId == null || label == null || count == null) return
  const reaction: WebQQMessageReaction = {
    emojiId,
    label,
    count,
  }
  const emojiUrl = readStringField(value, 'emojiUrl')
  const userId = readStringField(value, 'userId')
  const userAvatar = readStringField(value, 'userAvatar')
  const users = normalizeArray(value.users, normalizeWebQQReactionUser)
  if (emojiUrl != null) reaction.emojiUrl = emojiUrl
  if (userId != null) reaction.userId = userId
  if (userAvatar != null) reaction.userAvatar = userAvatar
  if (users.length) reaction.users = users
  return reaction
}

function normalizeWebQQUsage(value: unknown): WebQQMessage['usage'] | undefined {
  if (!isRecord(value)) return
  const inputTokens = readNumber(value.inputTokens)
  const outputTokens = readNumber(value.outputTokens)
  const ttftMs = readNumber(value.ttftMs)
  const totalMs = readNumber(value.totalMs)
  const tps = readNumber(value.tps)
  const hasUsage = inputTokens != null || outputTokens != null || ttftMs != null || totalMs != null || tps != null
  if (!hasUsage) return
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(ttftMs != null ? { ttftMs } : {}),
    ...(totalMs != null ? { totalMs } : {}),
    ...(tps != null ? { tps } : {}),
  }
}

function normalizeWebQQMessage(value: unknown): WebQQMessage | undefined {
  if (!isRecord(value)) return
  const id = readStringField(value, 'id')
  const sequence = readStringField(value, 'sequence')
  const time = readNumber(value.time)
  const senderId = readStringField(value, 'senderId')
  const senderName = readStringField(value, 'senderName')
  const senderAvatar = readStringField(value, 'senderAvatar')
  const direction = readMessageDirection(value.direction)
  const summary = readStringField(value, 'summary')
  if (
    id == null ||
    sequence == null ||
    time == null ||
    senderId == null ||
    senderName == null ||
    senderAvatar == null ||
    !direction ||
    summary == null ||
    !Array.isArray(value.elements)
  ) return
  const message: WebQQMessage = {
    id,
    sequence,
    time,
    senderId,
    senderName,
    senderAvatar,
    direction,
    summary,
    elements: normalizeArray(value.elements, normalizeWebQQMessageElement),
  }
  const senderRole = readStringField(value, 'senderRole')
  const senderLevel = readStringField(value, 'senderLevel')
  const senderTitle = readStringField(value, 'senderTitle')
  const senderAffinity = readNumber(value.senderAffinity)
  const recalled = readBoolean(value.recalled)
  const reactions = normalizeArray(value.reactions, normalizeWebQQReaction)
  if (senderRole != null) message.senderRole = senderRole
  if (senderLevel != null) message.senderLevel = senderLevel
  if (senderTitle != null) message.senderTitle = senderTitle
  if (senderAffinity != null) message.senderAffinity = senderAffinity
  if (recalled != null) message.recalled = recalled
  // 空数组也是有效的 reaction 快照，表示最后一个表情已被取消；不能按长度过滤，否则合并时旧胶囊会残留。
  if (Array.isArray(value.reactions)) message.reactions = reactions
  const usage = normalizeWebQQUsage(value.usage)
  if (usage) message.usage = usage
  if (isRecord(value.event)) {
    const eventType = readEventType(value.event.type)
    if (eventType) {
      const targetMessageId = readStringField(value.event, 'targetMessageId')
      message.event = {
        type: eventType,
        ...(targetMessageId != null ? { targetMessageId } : {}),
      }
    }
  }
  if (isRecord(value.thinking)) {
    const content = readStringField(value.thinking, 'content')
    const durationMs = readNumber(value.thinking.durationMs)
    if (content != null && durationMs != null) {
      const usage = normalizeWebQQUsage(value.thinking.usage)
      message.thinking = {
        content,
        durationMs,
        ...(usage ? { usage } : {}),
      }
    }
  }
  return message
}

function normalizeWebQQFriend(value: unknown): WebQQFriend | undefined {
  if (!isRecord(value)) return
  const userId = readStringField(value, 'userId')
  const name = readStringField(value, 'name')
  const nickname = readStringField(value, 'nickname')
  const avatar = readStringField(value, 'avatar')
  if (userId == null || name == null || nickname == null || avatar == null) return
  return {
    userId,
    name,
    nickname,
    avatar,
    ...(readStringField(value, 'categoryId') != null ? { categoryId: readStringField(value, 'categoryId') } : {}),
    ...(readStringField(value, 'categoryName') != null ? { categoryName: readStringField(value, 'categoryName') } : {}),
  }
}

function normalizeWebQQGroup(value: unknown): WebQQGroup | undefined {
  if (!isRecord(value)) return
  const groupId = readStringField(value, 'groupId')
  const name = readStringField(value, 'name')
  const memberCount = readNumber(value.memberCount)
  const avatar = readStringField(value, 'avatar')
  if (groupId == null || name == null || memberCount == null || avatar == null) return
  return { groupId, name, memberCount, avatar }
}

function normalizeWebQQFriendCategory(value: unknown): WebQQFriendCategory | undefined {
  if (!isRecord(value)) return
  const id = readStringField(value, 'id')
  const name = readStringField(value, 'name')
  if (id == null || name == null) return
  return {
    id,
    name,
    friends: normalizeArray(value.friends, normalizeWebQQFriend),
  }
}

function normalizeWebQQRecentContact(value: unknown): WebQQRecentContact | undefined {
  if (!isRecord(value)) return
  const type = value.type === 'friend' ? 'friend' : value.type === 'group' ? 'group' : undefined
  const peerId = readStringField(value, 'peerId')
  const name = readStringField(value, 'name')
  const subtitle = readStringField(value, 'subtitle')
  const avatar = readStringField(value, 'avatar')
  const summary = readStringField(value, 'summary')
  const time = readNumber(value.time)
  if (!type || peerId == null || name == null || subtitle == null || avatar == null || summary == null || time == null) return
  return { type, peerId, name, subtitle, avatar, summary, time }
}

function normalizeWebQQContacts(value: unknown): WebQQContacts {
  if (!isRecord(value)) return { friends: [], groups: [] }
  const friendCategories = normalizeArray(value.friendCategories, normalizeWebQQFriendCategory)
  const recent = normalizeArray(value.recent, normalizeWebQQRecentContact)
  return {
    friends: normalizeArray(value.friends, normalizeWebQQFriend),
    groups: normalizeArray(value.groups, normalizeWebQQGroup),
    ...(friendCategories.length ? { friendCategories } : {}),
    ...(recent.length ? { recent } : {}),
  }
}

function normalizeWebQQGroupAnnouncement(value: unknown): WebQQGroupAnnouncement | undefined {
  if (!isRecord(value)) return
  const id = readStringField(value, 'id')
  const title = readStringField(value, 'title')
  const content = readStringField(value, 'content')
  if (id == null || title == null || content == null) return
  const time = readNumber(value.time)
  return {
    id,
    title,
    content,
    ...(time != null ? { time } : {}),
  }
}

function normalizeWebQQGroupMember(value: unknown): WebQQGroupMember | undefined {
  if (!isRecord(value)) return
  const userId = readStringField(value, 'userId')
  const nickname = readStringField(value, 'nickname')
  const card = readStringField(value, 'card')
  const avatar = readStringField(value, 'avatar')
  if (userId == null || nickname == null || card == null || avatar == null) return
  // 撤回他人消息依赖协议原始角色；若只保留本地化 role，角色文案变化会让管理员权限判断失效。
  const rawRole = value.rawRole === 'owner' || value.rawRole === 'admin' || value.rawRole === 'member'
    ? value.rawRole
    : undefined
  return {
    userId,
    nickname,
    card,
    avatar,
    ...(readStringField(value, 'role') != null ? { role: readStringField(value, 'role') } : {}),
    ...(rawRole ? { rawRole } : {}),
  }
}

function normalizeWebQQGroupInfo(value: unknown): WebQQGroupInfo {
  if (!isRecord(value)) return { announcements: [], members: [] }
  return {
    announcements: normalizeArray(value.announcements, normalizeWebQQGroupAnnouncement),
    members: normalizeArray(value.members, normalizeWebQQGroupMember),
  }
}

function normalizeWebQQNotice(value: unknown): WebQQNotice | undefined {
  if (!isRecord(value)) return
  const id = readStringField(value, 'id')
  const type = readNoticeType(value.type)
  const title = readStringField(value, 'title')
  const subtitle = readStringField(value, 'subtitle')
  const avatar = readStringField(value, 'avatar')
  const status = readNoticeStatus(value.status)
  const time = readNumber(value.time)
  if (id == null || !type || title == null || subtitle == null || avatar == null || !status || time == null) return
  const notice: WebQQNotice = { id, type, title, subtitle, avatar, status, time }
  const flag = readStringField(value, 'flag')
  const subType = readStringField(value, 'subType')
  const requesterId = readStringField(value, 'requesterId')
  const requesterName = readStringField(value, 'requesterName')
  const groupId = readStringField(value, 'groupId')
  const groupName = readStringField(value, 'groupName')
  const comment = readStringField(value, 'comment')
  if (flag != null) notice.flag = flag
  if (subType != null) notice.subType = subType
  if (requesterId != null) notice.requesterId = requesterId
  if (requesterName != null) notice.requesterName = requesterName
  if (groupId != null) notice.groupId = groupId
  if (groupName != null) notice.groupName = groupName
  if (comment != null) notice.comment = comment
  return notice
}

export async function requestWebQQContacts() {
  return normalizeWebQQContacts(await invoke('onebot-webqq.contacts'))
}

export async function requestWebQQContactsWithRetry(requestContacts: () => Promise<WebQQContacts>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestContacts()
    } catch (error) {
      if (attempt >= webQQContactsRetryLimit) throw error
      await waitWebQQContactsRetry()
    }
  }
}

export async function requestWebQQMessages(query: WebQQMessageQuery) {
  return normalizeArray(await invoke('onebot-webqq.messages', query), normalizeWebQQMessage)
}

export async function searchWebQQMessages(query: WebQQMessageSearchQuery): Promise<WebQQMessageSearchResult> {
  const value = await invoke('onebot-webqq.messages.search', query)
  if (!isRecord(value)) return { messages: [], scannedCount: 0, exhausted: true }
  return {
    messages: normalizeArray(value.messages, normalizeWebQQMessage),
    scannedCount: readNumber(value.scannedCount) ?? 0,
    exhausted: readBoolean(value.exhausted) ?? true,
    ...(readStringField(value, 'nextBeforeSequence') ? { nextBeforeSequence: readStringField(value, 'nextBeforeSequence') } : {}),
  }
}

export async function requestWebQQRecordTranscription(messageId: string) {
  const text = await invoke('onebot-webqq.record.transcribe', { messageId })
  return typeof text === 'string' ? text : ''
}

export async function requestWebQQGroupInfo(groupId: string) {
  return normalizeWebQQGroupInfo(await invoke('onebot-webqq.group-info', { groupId }))
}

export async function requestWebQQNotices() {
  return normalizeArray(await invoke('onebot-webqq.notices'), normalizeWebQQNotice)
}

export async function approveWebQQNotice(notice: HandleableWebQQNotice, approve: boolean) {
  await invoke('onebot-webqq.notice-action', {
    id: notice.id,
    type: notice.type,
    flag: notice.flag,
    subType: notice.subType,
    approve,
  })
}

export async function sendWebQQMessage(payload: WebQQSendPayload) {
  await invoke('onebot-webqq.send', payload)
}

function normalizeWebQQProfileField(value: unknown): WebQQProfileField | undefined {
  if (!isRecord(value)) return
  const group = readStringField(value, 'group')
  const label = readStringField(value, 'label')
  const fieldValue = readStringField(value, 'value')
  if (group == null || label == null || fieldValue == null) return
  return { group, label, value: fieldValue }
}

function normalizeWebQQProfile(value: unknown): WebQQProfile | undefined {
  if (!isRecord(value)) return
  const kind = value.kind === 'bot' ? 'bot' : value.kind === 'user' ? 'user' : undefined
  const id = readStringField(value, 'id')
  const name = readStringField(value, 'name')
  const avatar = readStringField(value, 'avatar')
  if (!kind || id == null || name == null || avatar == null) return
  const profile: WebQQProfile = {
    kind,
    id,
    name,
    avatar,
    fields: normalizeArray(value.fields, normalizeWebQQProfileField),
  }
  const nickname = readStringField(value, 'nickname')
  const remark = readStringField(value, 'remark')
  const personalNote = readStringField(value, 'personalNote')
  const sex = readStringField(value, 'sex')
  const age = readNumber(value.age)
  const qid = readStringField(value, 'qid')
  const level = readStringField(value, 'level')
  const groupId = readStringField(value, 'groupId')
  const groupCard = readStringField(value, 'groupCard')
  const groupTitle = readStringField(value, 'groupTitle')
  const groupRole = readStringField(value, 'groupRole')
  const rawRole = value.rawRole === 'owner' || value.rawRole === 'admin' || value.rawRole === 'member'
    ? value.rawRole
    : undefined
  const canEditSelf = readBoolean(value.canEditSelf)
  const canEditAvatar = readBoolean(value.canEditAvatar)
  if (nickname != null) profile.nickname = nickname
  if (remark != null) profile.remark = remark
  if (personalNote != null) profile.personalNote = personalNote
  if (sex != null) profile.sex = sex
  if (age != null) profile.age = age
  if (qid != null) profile.qid = qid
  if (level != null) profile.level = level
  if (groupId != null) profile.groupId = groupId
  if (groupCard != null) profile.groupCard = groupCard
  if (groupTitle != null) profile.groupTitle = groupTitle
  if (groupRole != null) profile.groupRole = groupRole
  if (rawRole != null) profile.rawRole = rawRole
  if (canEditSelf != null) profile.canEditSelf = canEditSelf
  if (canEditAvatar != null) profile.canEditAvatar = canEditAvatar
  return profile
}

export async function recallWebQQMessage(input: WebQQMessageRecallInput) {
  await invoke('onebot-webqq.message-recall', input)
}

export async function setWebQQMessageReaction(input: WebQQMessageReactionInput) {
  await invoke('onebot-webqq.message-reaction', input)
}

export async function requestWebQQProfile(query: WebQQProfileQuery) {
  const profile = normalizeWebQQProfile(await invoke('onebot-webqq.profile', query))
  if (!profile) throw new Error(tr('webqq.error.loadProfile'))
  return profile
}

export async function updateWebQQSelfProfile(input: WebQQSelfProfileUpdate) {
  await invoke('onebot-webqq.self-profile', input)
}

export async function performWebQQFriendAction(input: WebQQFriendAction) {
  await invoke('onebot-webqq.friend-action', input)
}

export async function performWebQQGroupAction(input: WebQQGroupAction) {
  await invoke('onebot-webqq.group-action', input)
}

export async function sendWebQQForward(input: WebQQForwardSendInput) {
  await invoke('onebot-webqq.forward-send', input)
}
