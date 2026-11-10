export type WebQQChatType = 'friend' | 'group'

// WebQQ 只读面板使用的好友数据。
export interface WebQQFriend {
  userId: string
  name: string
  nickname: string
  avatar: string
  categoryId?: string
  categoryName?: string
}

// WebQQ 只读面板使用的群数据。
export interface WebQQGroup {
  groupId: string
  name: string
  memberCount: number
  avatar: string
}

// WebQQ 只读面板使用的合并转发节点。
export interface WebQQForwardItem {
  title?: string
  senderId?: string
  senderAvatar?: string
  elements: WebQQMessageElement[]
}

// WebQQ 只读面板使用的消息片段。
export interface WebQQMessageElement {
  type: 'text' | 'image' | 'quote' | 'forward' | 'card' | 'face' | 'file' | 'record' | 'video' | 'unknown'
  title?: string
  text?: string
  targetMessageId?: string
  duration?: number
  transcript?: string
  url?: string
  emojiUrl?: string
  imageUrl?: string
  source?: string
  items?: WebQQForwardItem[]
}

export interface WebQQMessageReaction {
  emojiId: string
  label: string
  emojiUrl?: string
  count: number
  userId?: string
  userAvatar?: string
  users?: WebQQMessageReactionUser[]
}

export interface WebQQMessageReactionUser {
  userId: string
  userName?: string
  userAvatar: string
}

// WebQQ 只读面板使用的历史消息。
export interface WebQQMessage {
  id: string
  sequence: string
  time: number
  senderId: string
  senderName: string
  senderAvatar: string
  senderRole?: string
  senderLevel?: string
  senderTitle?: string
  senderAffinity?: number
  direction: 'incoming' | 'outgoing'
  summary: string
  recalled?: boolean
  reactions?: WebQQMessageReaction[]
  event?: {
    type: 'recall' | 'poke' | 'mute' | 'reaction'
    targetMessageId?: string
  }
  usage?: {
    inputTokens: number
    outputTokens: number
    ttftMs?: number
    totalMs?: number
    tps?: number
  }
  thinking?: {
    content: string
    durationMs: number
    usage?: {
      inputTokens: number
      outputTokens: number
      ttftMs?: number
      totalMs?: number
      tps?: number
    }
  }
  elements: WebQQMessageElement[]
}

export interface WebQQLiveMessage {
  type: WebQQChatType
  peerId: string
  message: WebQQMessage
}

export interface WebQQRecallPayload {
  type: WebQQChatType
  peerId: string
  messageId: string
  mode: 'mark' | 'remove'
  eventMessage?: WebQQMessage
}

export interface WebQQNotice {
  id: string
  type: 'friend-request' | 'group-notice'
  title: string
  subtitle: string
  avatar: string
  status: 'pending' | 'approved' | 'rejected'
  time: number
  flag?: string
  subType?: string
  requesterId?: string
  requesterName?: string
  groupId?: string
  groupName?: string
  comment?: string
}

export interface WebQQNoticeAction {
  id: string
  type: WebQQNotice['type']
  flag: string
  subType?: string
  approve: boolean
}

export interface WebQQGroupAnnouncement {
  id: string
  title: string
  content: string
  time?: number
}

export interface WebQQGroupMember {
  userId: string
  nickname: string
  card: string
  avatar: string
  role?: string
  /** 菜单权限判断用的原始角色，避免依赖中文展示文案。 */
  rawRole?: 'owner' | 'admin' | 'member'
  title?: string
}

export interface WebQQGroupInfo {
  announcements: WebQQGroupAnnouncement[]
  members: WebQQGroupMember[]
}

export interface WebQQFriendCategory {
  id: string
  name: string
  friends: WebQQFriend[]
}

export interface WebQQRecentContact {
  type: WebQQChatType
  peerId: string
  name: string
  subtitle: string
  avatar: string
  summary: string
  time: number
}

export interface WebQQGroupInfoQuery {
  groupId: string
}

// WebQQ 只读面板一次加载的联系人数据。
export interface WebQQContacts {
  friends: WebQQFriend[]
  groups: WebQQGroup[]
  friendCategories?: WebQQFriendCategory[]
  recent?: WebQQRecentContact[]
}

export interface WebQQMessageQuery {
  type: WebQQChatType
  peerId: string
  limit?: number
  beforeSequence?: string
}

export interface WebQQMessageSearchQuery {
  type: WebQQChatType
  peerId: string
  keyword: string
  createdAtStart?: string
  createdAtEnd?: string
  beforeSequence?: string
}

export interface WebQQMessageSearchResult {
  messages: WebQQMessage[]
  scannedCount: number
  exhausted: boolean
  nextBeforeSequence?: string
}

export interface WebQQRecordTranscriptionQuery {
  messageId: string
}

export interface WebQQSendElement {
  type: 'text' | 'image' | 'video' | 'file' | 'quote' | 'at' | 'face'
  text?: string
  data?: string
  name?: string
  userId?: string
  targetMessageId?: string
  faceId?: string
}

export interface WebQQSendPayload {
  type: WebQQChatType
  peerId: string
  elements: WebQQSendElement[]
  /** 回复目标消息 ID；会在 OneBot message 前插入 reply 段。 */
  replyToMessageId?: string
}

export interface WebQQMessageRecallInput {
  type: WebQQChatType
  peerId: string
  messageId: string
}

export interface WebQQMessageReactionInput {
  type: WebQQChatType
  peerId: string
  messageId: string
  emojiId: string
  enabled: boolean
}

export type WebQQFriendAction =
  | { action: 'poke'; targetId: string }
  | { action: 'delete'; targetId: string }
  | { action: 'set-remark'; targetId: string; remark: string }

export type WebQQGroupAction =
  | { action: 'kick'; groupId: string; targetId: string }
  | { action: 'set-admin'; groupId: string; targetId: string; enabled: boolean }
  | { action: 'set-card'; groupId: string; targetId: string; card: string }
  | { action: 'set-title'; groupId: string; targetId: string; title: string }
  | { action: 'set-name'; groupId: string; name: string }
  | { action: 'poke'; groupId: string; targetId: string }
  | { action: 'leave'; groupId: string }

export interface WebQQForwardSendInput {
  type: WebQQChatType
  peerId: string
  messageIds: string[]
}

export interface WebQQProfileQuery {
  userId: string
  groupId?: string
}

export interface WebQQProfileField {
  group: string
  label: string
  value: string
}

export interface WebQQProfile {
  kind: 'user' | 'bot'
  id: string
  name: string
  avatar: string
  nickname?: string
  remark?: string
  personalNote?: string
  sex?: string
  age?: number
  qid?: string
  level?: string
  groupId?: string
  groupCard?: string
  groupTitle?: string
  groupRole?: string
  rawRole?: 'owner' | 'admin' | 'member'
  fields: WebQQProfileField[]
  /** 仅当前 selected bot 自身，且协议支持 set_qq_profile 时为 true。 */
  canEditSelf?: boolean
  /** 仅当前 selected bot 自身，且协议支持 set_qq_avatar 时为 true。 */
  canEditAvatar?: boolean
}

export interface WebQQSelfProfileUpdate {
  nickname?: string
  personalNote?: string
  sex?: string
  avatar?: string
}

// 存储与缓存那四条控制台请求的载荷类型。控制台契约要被前端引用，它引用的类型不能住在
// ./storage 下那些引用配置入口与数据库的 module 里，否则服务端依赖会被打进浏览器产物。
export interface WebQQConversationSummary {
  summary: string
  time: number
}

export interface WebQQStoredState {
  conversationSummaries: Record<string, WebQQConversationSummary>
  conversationUnreadCounts: Record<string, number>
  hiddenRecentKeys: string[]
}

export interface WebQQMessageCacheQuery {
  type: WebQQChatType
  peerId: string
}

export interface WebQQMessageCachePayload extends WebQQMessageCacheQuery {
  messages: WebQQMessage[]
}
