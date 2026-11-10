import { readStored, writeStored } from '@chatluna/ui-storage'
import type { MirroredConfigValues } from '../../src/config/spec'
import type { WebQQEvent } from '../../src/shared/console-contract'
import { filterWebQQSearchMessages } from '../../src/webqq/message-search'
import { tr } from '../i18n'
import {
  availableBots as availableBotsStore,
  capsule as capsuleStore,
  config as configStore,
  onWebQQEvent,
  selectedBotSelfId as selectedBotSelfIdStore,
  webQQTotalUnread,
  type CapsuleSnapshot,
} from '../runtime'
import {
  approveWebQQNotice,
  performWebQQFriendAction,
  performWebQQGroupAction,
  recallWebQQMessage,
  requestWebQQContacts,
  requestWebQQContactsWithRetry,
  requestWebQQGroupInfo,
  requestWebQQMessages,
  requestWebQQNotices,
  requestWebQQProfile,
  searchWebQQMessages,
  sendWebQQForward,
  sendWebQQMessage,
  setWebQQMessageReaction,
  updateWebQQSelfProfile,
} from './api/webqq'
import {
  loadBrowserWebQQStoredState,
  loadCachedWebQQMessages as loadStoredWebQQMessages,
  loadRemoteWebQQStoredState,
  persistWebQQStoredState,
  saveCachedWebQQMessages as saveStoredWebQQMessages,
} from './storage/webqq-storage'
import { applyCachedWebQQSenderMetadata, rememberWebQQSenderMetadata, type WebQQSenderMetadataCache } from './sender-metadata'
import type {
  WebQQContacts,
  WebQQConversationSummary,
  WebQQFriend,
  WebQQGroup,
  WebQQGroupInfo,
  WebQQGroupMember,
  WebQQLiveMessage,
  WebQQMessage,
  WebQQNotice,
  WebQQRecallPayload,
  WebQQSendElement,
} from './types'
import { localDateToMessageSearchRange } from './utils/message-search-date'
import { buildGroupProfileCardModel, buildProfileCardModelFromProfile, buildUserProfileCardModel, type ProfileCardModel } from './utils/profile-card'
import { rememberFloatingPanelAnchor } from './utils/floating-panel'
import {
  createFriendChatSelection,
  createGroupChatSelection,
  createRecentChatSelection,
  getChatKey,
  getGroupSubtitle,
  getRecentItems,
  getUnreadCount,
  getVisibleGroupMembers,
  hideRecentConversation,
  revealRecentConversation,
  type WebQQChatSelection,
  type WebQQRecentItem,
} from './utils/webqq-contact-view'
import { readWebQQErrorMessage } from './utils/webqq-error'
import { applyLocalWebQQReaction, applyLocalWebQQRecall } from './utils/webqq-interaction-state'
import {
  createBotThinkingMessage,
  getGroupMemberName,
  getMessageKey,
  hasOutgoingMessageAfter,
  mergeMessages,
  type WebQQMessageElement,
} from './utils/webqq-message-view'
import { hasNoticeFlag, sortPendingNotices } from './utils/webqq-notice-view'
import { applyWebQQRecallToMessages } from './utils/webqq-recall-view'
import type { WebQQMentionCandidate } from './utils/webqq-composer-draft'

export type WebQQTab = 'recent' | 'friends' | 'groups'
export type WebQQNoticeTab = 'friends' | 'groups'

/** 输入对话框的一次征询。提交回调是 spec 的字段：「对话框开着」与「提交回调在场」是同一个事实。 */
export interface WebQQActionDialogSpec {
  title: string
  description?: string
  placeholder?: string
  value?: string
  confirmText?: string
  submit: (value: string) => void | Promise<void>
}

/** 确认对话框的一次征询。字段与协议都与输入对话框不同，因此是两份独立类型。 */
export interface WebQQConfirmDialogSpec {
  title: string
  description: string
  confirmText: string
  submit: () => Promise<void>
}

export interface WebQQComposerMentionRequest {
  id: string
  name: string
}

export interface WebQQComposerSubmitResult {
  sent: boolean
  restoreFocus: boolean
}

export interface WebQQForwardTargetOption {
  id: string
  type: 'friend' | 'group'
  peerId: string
  title: string
  subtitle?: string
  avatar?: string
}

export interface WebQQForwardTargetModel {
  recent: WebQQForwardTargetOption[]
  friends: WebQQForwardTargetOption[]
  groups: WebQQForwardTargetOption[]
}

export interface WebQQShellSize {
  width: number
  height: number
}

type WebQQGroupMemberPatch = Partial<Pick<WebQQGroupMember, 'card' | 'role' | 'rawRole' | 'title'>>
const groupMemberPatchFields = ['card', 'role', 'rawRole', 'title'] as const

export interface WebQQState {
  activeTab: WebQQTab
  searchQuery: string
  contacts: WebQQContacts
  currentChat?: WebQQChatSelection
  conversationSummaries: Record<string, WebQQConversationSummary>
  conversationUnreadCounts: Record<string, number>
  hiddenRecentKeys: string[]
  senderMetadataCache: WebQQSenderMetadataCache
  expandedThinkingMessageIds: ReadonlySet<string>
  loading: boolean
  errorText: string
  contactsLoadFailed: boolean
  imagePreviewUrl: string
  sendingWebQQMessage: boolean
  webQQSendSpace: number
  composerMentionRequest?: WebQQComposerMentionRequest
  messages: WebQQMessage[]
  botThinkingMessages: Record<string, WebQQMessage>
  historyLoading: boolean
  historyExhausted: boolean
  trackingMessages: boolean
  selectionMode: boolean
  selectedMessageIds: string[]
  messageSearchOpen: boolean
  messageSearchQuery: string
  messageSearchLocalDate: string
  messageSearchResults: WebQQMessage[]
  messageSearchLoading: boolean
  messageSearchErrorText: string
  messageSearchSearched: boolean
  messageSearchExhausted: boolean
  forwardTargetOpen: boolean
  replyingToMessageId: string
  reactionPickerMessageId: string
  profileCardOpen: boolean
  profileCardModel?: ProfileCardModel
  actionDialogSpec?: WebQQActionDialogSpec
  confirmDialogSpec?: WebQQConfirmDialogSpec
  notices: WebQQNotice[]
  noticeOpen: boolean
  noticeMenuTab: WebQQNoticeTab
  noticeLoading: boolean
  handlingNoticeId: string
  noticeErrorText: string
  groupInfoOpen: boolean
  groupInfoLoading: boolean
  groupInfoErrorText: string
  groupInfoSearchQuery: string
  groupInfo: WebQQGroupInfo
  forwardDialog?: WebQQMessageElement
  cachedSendBotAvatars: Record<string, string>
}

const WEBQQ_SEND_AVATAR_STORAGE_KEY = 'chatluna.onebot-webqq.send-avatars'
const BOT_PROFILE_STORAGE_KEY = 'chatluna.onebot-webqq.bot-profile'
// 客户端这层超时独立于服务端的翻页预算：WebUI 连接断开或服务端进程卡死时，服务端的预算一次都不会触发。
// 比服务端最长的一档（SnowLuma 16 秒）再多留一些。
const MESSAGE_SEARCH_TIMEOUT_MS = 20000

function emptyGroupInfo(): WebQQGroupInfo {
  return { announcements: [], members: [] }
}

function readSendAvatarCache(): Record<string, string> {
  const data = readStored(WEBQQ_SEND_AVATAR_STORAGE_KEY)
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  return Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function readCachedCapsuleBotAvatar() {
  const data = readStored(BOT_PROFILE_STORAGE_KEY)
  const avatar = data && typeof data === 'object' ? Reflect.get(data, 'avatar') : undefined
  return typeof avatar === 'string' ? avatar : ''
}

function chatKeyOf(chat: Pick<WebQQChatSelection, 'type' | 'peerId'> | undefined) {
  return chat ? `${chat.type}:${chat.peerId}` : ''
}

/**
 * WebQQ 观察窗的状态与编排：原插件里观察窗组件与它的十几个 store 拆在 Vue 的响应式里，这里合成
 * 一个普通对象。界面通过 `subscribe`/`getState` 订阅整份状态；原来的 `watch` 改成状态变化时由
 * `commit` 显式触发的副作用，名字与原 store 的函数一一对应，便于对照。
 */
export class WebQQController {
  private state: WebQQState
  private listeners = new Set<() => void>()
  private disposers: Array<() => void> = []
  private afterRenderQueue: Array<() => void> = []

  /** 消息列表的滚动容器；滚动与「贴底」判断都读它。由组件在挂载时登记。 */
  messagePane: HTMLElement | null = null
  /** 观察窗是否显示；未读计数与焦点恢复按它判断。 */
  visible = false
  /** 让消息列表滚动到指定消息；由消息列表组件登记。 */
  scrollToMessage: (messageKey: string) => boolean = () => false
  /** 查找框关闭后把焦点还给查找按钮；由观察窗组件登记。 */
  restoreSearchTriggerFocus: () => void = () => {}

  private contactsLoadVersion = 0
  private returningMessagesToBottom = false
  private groupInfoCache: Record<string, WebQQGroupInfo> = {}
  private groupInfoRequestTokens: Record<string, number> = {}
  private groupMemberPatches: Record<string, Record<string, WebQQGroupMemberPatch>> = {}
  private messageSearchSerial = 0
  private nextBeforeSequence = ''
  private cacheWriteQueue = new Map<string, Promise<void>>()
  private cachedCapsuleBotAvatar = readCachedCapsuleBotAvatar()
  private lastRecoverySignal = ''
  private lastSelectedSelfId = selectedBotSelfIdStore.get()

  constructor() {
    const stored = loadBrowserWebQQStoredState(this.config.webQQStorageBackend, this.storageScope)
    this.state = {
      activeTab: 'recent',
      searchQuery: '',
      contacts: { friends: [], groups: [] },
      conversationSummaries: stored.conversationSummaries,
      conversationUnreadCounts: stored.conversationUnreadCounts,
      hiddenRecentKeys: stored.hiddenRecentKeys,
      senderMetadataCache: {},
      expandedThinkingMessageIds: new Set(),
      loading: false,
      errorText: '',
      contactsLoadFailed: false,
      imagePreviewUrl: '',
      sendingWebQQMessage: false,
      webQQSendSpace: 80,
      messages: [],
      botThinkingMessages: {},
      historyLoading: false,
      historyExhausted: false,
      trackingMessages: true,
      selectionMode: false,
      selectedMessageIds: [],
      messageSearchOpen: false,
      messageSearchQuery: '',
      messageSearchLocalDate: '',
      messageSearchResults: [],
      messageSearchLoading: false,
      messageSearchErrorText: '',
      messageSearchSearched: false,
      messageSearchExhausted: true,
      forwardTargetOpen: false,
      replyingToMessageId: '',
      reactionPickerMessageId: '',
      profileCardOpen: false,
      notices: [],
      noticeOpen: false,
      noticeMenuTab: 'friends',
      noticeLoading: false,
      handlingNoticeId: '',
      noticeErrorText: '',
      groupInfoOpen: false,
      groupInfoLoading: false,
      groupInfoErrorText: '',
      groupInfoSearchQuery: '',
      groupInfo: emptyGroupInfo(),
      cachedSendBotAvatars: readSendAvatarCache(),
    }
    this.lastRecoverySignal = this.contactsRecoverySignal()
  }

  // ── 订阅 ─────────────────────────────────────────────────────────────

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = () => this.state

  /** 等到界面把当前状态渲染出来（原 Vue `nextTick`）。组件每次提交后调用 `flushAfterRender`。 */
  nextTick() {
    return new Promise<void>((resolve) => {
      this.afterRenderQueue.push(resolve)
      // 状态没变化时不会有提交，两帧后兜底放行。
      requestAnimationFrame(() => requestAnimationFrame(() => this.flushAfterRender()))
    })
  }

  flushAfterRender() {
    for (const resolve of this.afterRenderQueue.splice(0)) resolve()
  }

  private get config(): MirroredConfigValues {
    return configStore.get()
  }

  private get storageScope() {
    return availableBotsStore.get().length > 1 ? selectedBotSelfIdStore.get() : ''
  }

  get currentOperatorId() {
    return selectedBotSelfIdStore.get() || availableBotsStore.get()[0]?.selfId || ''
  }

  /** 写入新状态并跑原来挂在 watch 上的同步副作用。 */
  private commit(patch: Partial<WebQQState>) {
    const prev = this.state
    let next: WebQQState = { ...prev, ...patch }
    if (next.messages !== prev.messages || next.currentChat !== prev.currentChat) {
      next = this.syncBotThinkingMessage(next)
    }
    this.state = next
    if (next.conversationUnreadCounts !== prev.conversationUnreadCounts) {
      webQQTotalUnread.set(Object.values(next.conversationUnreadCounts).reduce((sum, count) => sum + count, 0))
    }
    const prevThinking = this.botThinkingMessageOf(prev)
    const nextThinking = this.botThinkingMessageOf(next)
    if (nextThinking !== prevThinking) {
      if (nextThinking && next.currentChat) this.rememberMessageSenderMetadata(next.currentChat.type, next.currentChat.peerId, [nextThinking])
      if (this.state.trackingMessages) void this.scrollMessagesToBottom()
    }
    for (const listener of [...this.listeners]) listener()
  }

  // ── 生命周期 ─────────────────────────────────────────────────────────

  async mount() {
    webQQTotalUnread.set(Object.values(this.state.conversationUnreadCounts).reduce((sum, count) => sum + count, 0))
    this.disposers.push(onWebQQEvent((event) => this.handleEvent(event)))
    this.disposers.push(capsuleStore.subscribe(() => {
      this.commit(this.syncBotThinkingMessage(this.state))
      this.rememberCapsuleBotAvatar(capsuleStore.get())
      this.checkContactsRecovery()
    }))
    this.disposers.push(availableBotsStore.subscribe(() => {
      for (const bot of availableBotsStore.get()) this.rememberSendBotAvatar(bot.selfId, bot.avatar)
      this.checkContactsRecovery()
    }))
    this.disposers.push(selectedBotSelfIdStore.subscribe(() => {
      const selfId = selectedBotSelfIdStore.get()
      this.checkContactsRecovery()
      if (!selfId || selfId === this.lastSelectedSelfId) return
      this.lastSelectedSelfId = selfId
      void this.reloadWebQQForSelectedBot()
    }))
    for (const bot of availableBotsStore.get()) this.rememberSendBotAvatar(bot.selfId, bot.avatar)
    this.rememberCapsuleBotAvatar(capsuleStore.get())
    await this.loadRemoteWebQQStoredState()
    await this.loadContacts()
  }

  dispose() {
    for (const dispose of this.disposers.splice(0)) dispose()
    this.cacheWriteQueue.clear()
    this.flushAfterRender()
  }

  setVisible(visible: boolean) {
    if (this.visible === visible) return
    this.visible = visible
    if (!visible) {
      this.closeMessageSearch()
      this.commit({ noticeOpen: false, profileCardOpen: false, reactionPickerMessageId: '', forwardTargetOpen: false, actionDialogSpec: undefined, confirmDialogSpec: undefined })
      return
    }
    this.clearCurrentUnreadCount()
    if (this.state.trackingMessages) void this.scrollMessagesToBottom()
  }

  // ── 机器人头像 ───────────────────────────────────────────────────────

  private rememberSendBotAvatar(selfId?: string, avatar?: string) {
    if (!selfId || !avatar || this.state.cachedSendBotAvatars[selfId] === avatar) return
    const cachedSendBotAvatars = { ...this.state.cachedSendBotAvatars, [selfId]: avatar }
    this.commit({ cachedSendBotAvatars })
    writeStored(WEBQQ_SEND_AVATAR_STORAGE_KEY, cachedSendBotAvatars)
  }

  private rememberCapsuleBotAvatar(capsule: CapsuleSnapshot | undefined) {
    const bot = capsule?.bot
    if (bot?.avatar) this.cachedCapsuleBotAvatar = bot.avatar
    this.rememberSendBotAvatar(bot?.selfId, bot?.avatar)
  }

  selectedBotAvatar() {
    const bots = availableBotsStore.get()
    const selectedSelfId = selectedBotSelfIdStore.get()
    const selected = bots.find((bot) => bot.selfId === selectedSelfId)
    const selfId = selected?.selfId || selectedSelfId
    const capsuleBot = capsuleStore.get()?.bot
    const fallback = bots[0]
    const cached = this.state.cachedSendBotAvatars
    const displayBotAvatar = selected?.avatar || (!selfId || capsuleBot?.selfId === selfId ? capsuleBot?.avatar : '')
    return displayBotAvatar
      || this.cachedCapsuleBotAvatar
      || (selfId ? cached[selfId] : '')
      || fallback?.avatar
      || (fallback?.selfId ? cached[fallback.selfId] : '')
      || ''
  }

  // ── 会话摘要、未读与隐藏的最近会话（原 useWebQQConversationState） ──────

  private persistWebQQState() {
    persistWebQQStoredState(this.config.webQQStorageBackend, {
      conversationSummaries: this.state.conversationSummaries,
      conversationUnreadCounts: this.state.conversationUnreadCounts,
      hiddenRecentKeys: this.state.hiddenRecentKeys,
    }, this.storageScope)
  }

  private async loadRemoteWebQQStoredState() {
    const backend = this.config.webQQStorageBackend
    const stored = backend === 'browser'
      ? loadBrowserWebQQStoredState(backend, this.storageScope)
      : await loadRemoteWebQQStoredState(backend)
    if (stored) this.commit(stored)
  }

  revealRecentConversation(type: WebQQChatSelection['type'], peerId: string) {
    const next = revealRecentConversation(this.state.hiddenRecentKeys, type, peerId)
    if (next === this.state.hiddenRecentKeys) return
    this.commit({ hiddenRecentKeys: next })
    this.persistWebQQState()
  }

  private hideRecentConversation(type: WebQQChatSelection['type'], peerId: string) {
    const next = hideRecentConversation(this.state.hiddenRecentKeys, type, peerId)
    if (next === this.state.hiddenRecentKeys) return
    this.commit({ hiddenRecentKeys: next })
    this.persistWebQQState()
  }

  private updateConversationSummary(type: WebQQChatSelection['type'], peerId: string, message?: WebQQMessage) {
    if (!message) return
    this.commit({
      conversationSummaries: {
        ...this.state.conversationSummaries,
        [getChatKey(type, peerId)]: { summary: message.summary, time: message.time },
      },
      hiddenRecentKeys: revealRecentConversation(this.state.hiddenRecentKeys, type, peerId),
    })
    this.persistWebQQState()
  }

  private increaseUnreadCount(type: WebQQChatSelection['type'], peerId: string) {
    const key = getChatKey(type, peerId)
    this.commit({
      conversationUnreadCounts: {
        ...this.state.conversationUnreadCounts,
        [key]: (this.state.conversationUnreadCounts[key] || 0) + 1,
      },
      hiddenRecentKeys: revealRecentConversation(this.state.hiddenRecentKeys, type, peerId),
    })
    this.persistWebQQState()
  }

  private clearUnreadCount(type: WebQQChatSelection['type'], peerId: string) {
    const key = getChatKey(type, peerId)
    if (!this.state.conversationUnreadCounts[key]) return
    const conversationUnreadCounts = { ...this.state.conversationUnreadCounts }
    delete conversationUnreadCounts[key]
    this.commit({ conversationUnreadCounts })
    this.persistWebQQState()
  }

  getUnreadCount = (type: WebQQChatSelection['type'], peerId: string) => getUnreadCount(this.state.conversationUnreadCounts, type, peerId)

  private clearCurrentUnreadCount() {
    const chat = this.state.currentChat
    if (chat) this.clearUnreadCount(chat.type, chat.peerId)
  }

  // ── 联系人与会话选择（原 useWebQQContacts） ───────────────────────────

  recentItems(): WebQQRecentItem[] {
    return getRecentItems(this.state.contacts, this.state.conversationSummaries, this.state.hiddenRecentKeys)
  }

  setSearchQuery(searchQuery: string) {
    this.commit({ searchQuery })
  }

  selectTab(activeTab: WebQQTab) {
    this.commit({ activeTab, noticeOpen: false })
  }

  /** 切换当前会话，并跑原来挂在 currentChat 与 currentChat.peerId 上的两个 watch。 */
  private setCurrentChat(currentChat: WebQQChatSelection | undefined) {
    const previousPeerId = this.state.currentChat?.peerId
    this.commit({
      currentChat,
      selectionMode: false,
      selectedMessageIds: [],
      forwardTargetOpen: false,
      replyingToMessageId: '',
      reactionPickerMessageId: '',
      profileCardOpen: false,
    })
    this.closeMessageSearch()
    if (currentChat?.peerId === previousPeerId) return
    this.commit({ groupInfoSearchQuery: '' })
    if (currentChat?.type !== 'group') {
      this.commit({ groupInfoOpen: false, groupInfo: emptyGroupInfo() })
      return
    }
    // 消息头像菜单和管理员撤回权限都依赖成员角色，不能要求用户先手动打开群资料侧栏。
    void this.loadGroupInfo()
  }

  selectFriend(friend: WebQQFriend) {
    this.commit({ noticeOpen: false, groupInfoOpen: false })
    this.revealRecentConversation('friend', friend.userId)
    this.setCurrentChat(createFriendChatSelection(friend))
    this.clearCurrentUnreadCount()
    void this.loadMessages()
  }

  selectGroup(group: WebQQGroup) {
    this.commit({ noticeOpen: false })
    this.revealRecentConversation('group', group.groupId)
    this.setCurrentChat(createGroupChatSelection(group))
    this.clearCurrentUnreadCount()
    void this.loadMessages()
  }

  selectRecent(item: WebQQRecentItem) {
    this.commit({ noticeOpen: false, ...(item.type !== 'group' ? { groupInfoOpen: false } : {}) })
    this.setCurrentChat(createRecentChatSelection(item))
    this.clearCurrentUnreadCount()
    void this.loadMessages()
  }

  handleDeleteRecent(item: WebQQRecentItem) {
    this.hideRecentConversation(item.type, item.peerId)
    this.clearUnreadCount(item.type, item.peerId)
    const chat = this.state.currentChat
    if (chat?.type !== item.type || chat.peerId !== item.peerId) return
    this.setCurrentChat(undefined)
    this.commit({ messages: [], groupInfoOpen: false })
  }

  private contactsRecoverySignal() {
    return JSON.stringify({
      selectedSelfId: selectedBotSelfIdStore.get(),
      bots: availableBotsStore.get().map((bot) => [bot.selfId, bot.status]),
      conversationTimestamp: capsuleStore.get()?.conversation?.timestamp,
    })
  }

  private checkContactsRecovery() {
    const signal = this.contactsRecoverySignal()
    if (signal === this.lastRecoverySignal) return
    this.lastRecoverySignal = signal
    if (!this.state.contactsLoadFailed || this.state.loading) return
    void this.loadContacts()
  }

  async loadContacts() {
    const loadVersion = ++this.contactsLoadVersion
    const recoverySignal = this.contactsRecoverySignal()
    this.commit({ loading: true, errorText: '' })
    try {
      const contacts = await requestWebQQContactsWithRetry(requestWebQQContacts)
      if (loadVersion !== this.contactsLoadVersion) return
      this.commit({ contacts, contactsLoadFailed: false })
    } catch (error) {
      if (loadVersion !== this.contactsLoadVersion) return
      this.commit({ contactsLoadFailed: true, errorText: readWebQQErrorMessage(error, tr('webqq.error.loadContacts')) })
      // 首次请求重试期间 Bot 可能已经恢复或收到消息；该变化早于 catch 时，普通订阅会错过。
      // 这里补一次重载，避免固定重试窗口结束后联系人页永久停在失败状态。
      if (recoverySignal !== this.contactsRecoverySignal()) void this.nextTick().then(() => this.loadContacts())
    } finally {
      if (loadVersion === this.contactsLoadVersion) this.commit({ loading: false })
    }
  }

  private async reloadWebQQForSelectedBot() {
    this.commit({
      activeTab: 'recent',
      searchQuery: '',
      contacts: { friends: [], groups: [] },
      conversationSummaries: {},
      conversationUnreadCounts: {},
      hiddenRecentKeys: [],
      messages: [],
      groupInfoOpen: false,
      groupInfo: emptyGroupInfo(),
    })
    this.setCurrentChat(undefined)
    await this.loadRemoteWebQQStoredState()
    await this.loadContacts()
  }

  // ── 发送者群身份缓存与思考块展开（原 useWebQQSenderMetadata / useWebQQThinkingExpansion） ──

  private rememberMessageSenderMetadata(type: WebQQChatSelection['type'], peerId: string, messages: WebQQMessage[]) {
    const senderMetadataCache = rememberWebQQSenderMetadata(this.state.senderMetadataCache, type, peerId, messages)
    if (senderMetadataCache !== this.state.senderMetadataCache) this.commit({ senderMetadataCache })
  }

  isThinkingExpanded = (message: WebQQMessage) => this.state.expandedThinkingMessageIds.has(getMessageKey(message))

  toggleThinking = (message: WebQQMessage) => {
    const key = getMessageKey(message)
    const next = new Set(this.state.expandedThinkingMessageIds)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    this.commit({ expandedThinkingMessageIds: next })
  }

  // ── 消息列表（原 useWebQQMessageList） ───────────────────────────────

  private botThinkingMessageOf(state: WebQQState) {
    const key = chatKeyOf(state.currentChat)
    return key ? state.botThinkingMessages[key] : undefined
  }

  botThinkingMessage() {
    return this.botThinkingMessageOf(this.state)
  }

  /**
   * 等待气泡：小胶囊指向当前会话且处于「正在思考」时造一条。造不出时只在两种情况下清理：小胶囊指向当前
   * 会话（本会话确已空闲），或当前会话已有更晚的机器人消息（本会话已回复）。其他会话抢占小胶囊时保留。
   */
  private syncBotThinkingMessage(state: WebQQState): WebQQState {
    const key = chatKeyOf(state.currentChat)
    if (!key) return state
    const capsule = capsuleStore.get()
    const next = createBotThinkingMessage(capsule, state.currentChat, state.messages)
    if (next) {
      const current = state.botThinkingMessages[key]
      if (current && current.id === next.id && JSON.stringify(current) === JSON.stringify(next)) return state
      return { ...state, botThinkingMessages: { ...state.botThinkingMessages, [key]: next } }
    }
    const cached = state.botThinkingMessages[key]
    if (!cached) return state
    const conversation = capsule?.conversation
    const capsuleKey = state.currentChat && conversation
      ? `${state.currentChat.type}:${state.currentChat.type === 'group' ? conversation.channelId : conversation.userId || conversation.channelId}`
      : ''
    if (capsuleKey !== key && !hasOutgoingMessageAfter(state.messages, cached.time)) return state
    const botThinkingMessages = { ...state.botThinkingMessages }
    delete botThinkingMessages[key]
    return { ...state, botThinkingMessages }
  }

  /** 当前会话的群成员资料覆盖消息上的发送者名与群身份（原观察窗的 applyCurrentGroupMemberMetadata）。 */
  applyCurrentGroupMemberMetadata(message: WebQQMessage) {
    const { currentChat, senderMetadataCache, groupInfo } = this.state
    const hydrated = currentChat
      ? applyCachedWebQQSenderMetadata(senderMetadataCache, currentChat.type, currentChat.peerId, message)
      : message
    if (currentChat?.type !== 'group') return hydrated
    const member = groupInfo.members.find((item) => item.userId === message.senderId)
    if (!member) return hydrated
    return {
      ...hydrated,
      senderName: getGroupMemberName(member),
      senderRole: member.role,
      senderTitle: member.title || undefined,
    }
  }

  private memoVisible?: { messages: WebQQMessage[], thinking?: WebQQMessage, cache: WebQQSenderMetadataCache, groupInfo: WebQQGroupInfo, chat?: WebQQChatSelection, result: WebQQMessage[] }

  visibleMessages(): WebQQMessage[] {
    const { messages, senderMetadataCache, groupInfo, currentChat } = this.state
    const thinking = this.botThinkingMessage()
    const memo = this.memoVisible
    if (memo && memo.messages === messages && memo.thinking === thinking && memo.cache === senderMetadataCache && memo.groupInfo === groupInfo && memo.chat === currentChat) return memo.result
    const cached = messages.map((message) => this.applyCurrentGroupMemberMetadata(message))
    const result = thinking ? [...cached, this.applyCurrentGroupMemberMetadata(thinking)] : cached
    this.memoVisible = { messages, thinking, cache: senderMetadataCache, groupInfo, chat: currentChat, result }
    return result
  }

  isBotThinkingMessage = (message: WebQQMessage) => message.id === this.botThinkingMessage()?.id

  private limitMessages(messages: WebQQMessage[]) {
    return messages.slice(-this.config.webQQMessageCacheLimit)
  }

  private appendMessage(message: WebQQMessage) {
    this.commit({ messages: this.limitMessages(mergeMessages(this.state.messages, [message])) })
    if (this.state.trackingMessages) void this.scrollMessagesToBottom()
  }

  // ── 消息缓存 ─────────────────────────────────────────────────────────

  private loadCachedMessages(type: WebQQChatSelection['type'], peerId: string) {
    return loadStoredWebQQMessages(type, peerId, this.config.webQQStorageBackend, this.storageScope)
  }

  private saveCachedMessages(type: WebQQChatSelection['type'], peerId: string, messages: WebQQMessage[]) {
    return saveStoredWebQQMessages(type, peerId, messages, this.config.webQQStorageBackend, this.config.webQQMessageCacheLimit, this.storageScope)
  }

  // ── 滚动（原 useWebQQMessageScroll） ─────────────────────────────────

  private isMessagePaneAtBottom() {
    const pane = this.messagePane
    if (!pane) return true
    return pane.scrollHeight - pane.scrollTop - pane.clientHeight <= 8
  }

  updateMessageTracking = () => {
    const atBottom = this.isMessagePaneAtBottom()
    if (this.returningMessagesToBottom) {
      if (!this.state.trackingMessages) this.commit({ trackingMessages: true })
      if (atBottom) {
        this.returningMessagesToBottom = false
        this.clearCurrentUnreadCount()
      }
      return
    }
    if (this.state.trackingMessages !== atBottom) this.commit({ trackingMessages: atBottom })
    if (atBottom) this.clearCurrentUnreadCount()
  }

  async scrollMessagesToBottom(behavior: ScrollBehavior = 'auto') {
    await this.nextTick()
    const pane = this.messagePane
    if (!pane) return
    pane.scrollTo({ top: pane.scrollHeight, behavior })
  }

  handleMessageImageLoad = () => {
    if (this.state.trackingMessages) void this.scrollMessagesToBottom()
  }

  returnMessagesToBottom = () => {
    this.returningMessagesToBottom = true
    this.commit({ trackingMessages: true })
    void this.scrollMessagesToBottom('smooth')
  }

  setSendSpace(webQQSendSpace: number) {
    if (webQQSendSpace === this.state.webQQSendSpace) return
    this.commit({ webQQSendSpace })
    if (this.state.trackingMessages) void this.scrollMessagesToBottom()
  }

  // ── 聊天历史（原 useWebQQMessageHistory） ────────────────────────────

  private isCurrentChat(chat: Pick<WebQQChatSelection, 'type' | 'peerId'>) {
    const current = this.state.currentChat
    return current?.type === chat.type && current.peerId === chat.peerId
  }

  private async scrollLoadedMessagesToBottom() {
    if (!this.state.errorText && this.state.trackingMessages) await this.scrollMessagesToBottom()
  }

  async loadMessages() {
    const chat = this.state.currentChat
    if (!chat) return
    this.commit({ trackingMessages: true, historyExhausted: false, errorText: '', messages: [] })
    // 本地缓存只是加速首屏，读失败不代表这个会话没有历史；不能因此停在「加载聊天历史失败」。
    let cacheErrorText = ''
    try {
      const cached = await this.loadCachedMessages(chat.type, chat.peerId)
      if (!this.isCurrentChat(chat)) return
      this.commit({ messages: this.limitMessages(cached) })
    } catch (error) {
      if (!this.isCurrentChat(chat)) return
      cacheErrorText = readWebQQErrorMessage(error, tr('webqq.error.loadHistoryCache'))
    }
    await this.scrollLoadedMessagesToBottom()
    try {
      const remote = await requestWebQQMessages({ type: chat.type, peerId: chat.peerId })
      if (!this.isCurrentChat(chat)) return
      const messages = this.limitMessages(mergeMessages(this.state.messages, remote))
      this.commit({ messages })
      this.rememberMessageSenderMetadata(chat.type, chat.peerId, messages)
      this.updateConversationSummary(chat.type, chat.peerId, messages.at(-1))
      await this.saveCachedMessages(chat.type, chat.peerId, messages)
    } catch (error) {
      if (!this.isCurrentChat(chat) || this.state.messages.length) return
      this.commit({ errorText: readWebQQErrorMessage(error, tr('webqq.error.loadHistory')) })
    }
    // 远端成功但缓存读失败时仍要让用户看到缓存故障，否则数据库问题会被静默掉。
    if (!this.state.errorText && cacheErrorText && !this.state.messages.length) this.commit({ errorText: cacheErrorText })
    await this.scrollLoadedMessagesToBottom()
  }

  /**
   * 更早历史入口的显示判定：由用户点入口取回，不随滚动到顶自动发起。界面上没有消息时不显示入口：
   * 那时没有可用的更早边界，请求回来的是最新一页而不是更早一页。
   */
  canLoadOlderMessages() {
    return !!this.state.currentChat && this.state.messages.length > 0 && !this.state.historyExhausted
  }

  loadOlderMessages = async () => {
    const chat = this.state.currentChat
    if (!chat || this.state.historyLoading || this.state.historyExhausted) return
    const pane = this.messagePane
    // 补偿基线连滚动位置一起记下：入口在列表顶端但点它时 scrollTop 通常不是 0；把高度差加回原位置，
    // 用户正在读的那一行才留在原处。
    const previousScrollHeight = pane?.scrollHeight ?? 0
    const previousScrollTop = pane?.scrollTop ?? 0
    this.commit({ historyLoading: true })
    try {
      const older = await requestWebQQMessages({
        type: chat.type,
        peerId: chat.peerId,
        beforeSequence: this.state.messages[0]?.sequence,
      })
      this.rememberMessageSenderMetadata(chat.type, chat.peerId, older)
      const previousLength = this.state.messages.length
      // 取回更早历史是在扩展当前历史窗口，不能套最近消息上限，否则更早页会被立刻裁掉并反复请求同一页。
      const messages = mergeMessages(older, this.state.messages)
      this.commit({ messages, historyExhausted: older.length === 0 || messages.length === previousLength })
      this.updateConversationSummary(chat.type, chat.peerId, messages.at(-1))
      await this.saveCachedMessages(chat.type, chat.peerId, messages)
      await this.nextTick()
      if (pane) pane.scrollTop = previousScrollTop + (pane.scrollHeight - previousScrollHeight)
    } catch (error) {
      this.commit({ errorText: readWebQQErrorMessage(error, tr('webqq.error.loadOlderHistory')) })
    } finally {
      this.commit({ historyLoading: false })
    }
  }

  // ── 实时消息与撤回（原 useWebQQLiveMessages） ────────────────────────

  private enqueueCachedMessagesUpdate(type: WebQQChatSelection['type'], peerId: string, update: (messages: WebQQMessage[]) => WebQQMessage[]) {
    const key = `${type}:${peerId}`
    const previous = this.cacheWriteQueue.get(key)
    const run = async () => {
      const cached = await this.loadCachedMessages(type, peerId)
      await this.saveCachedMessages(type, peerId, update(cached))
    }
    const next = previous ? previous.catch(() => {}).then(run) : run()
    this.cacheWriteQueue.set(key, next)
    const clear = () => {
      if (this.cacheWriteQueue.get(key) === next) this.cacheWriteQueue.delete(key)
    }
    next.then(clear, clear)
    return next
  }

  private handleEvent(event: WebQQEvent) {
    if (event.type === 'message') this.handleLiveMessage(event.payload)
    else this.handleRecall(event.payload)
  }

  private handleLiveMessage(payload: WebQQLiveMessage) {
    this.rememberMessageSenderMetadata(payload.type, payload.peerId, [payload.message])
    this.updateConversationSummary(payload.type, payload.peerId, payload.message)
    if (!this.isCurrentChat(payload)) {
      if (payload.message.direction === 'incoming') this.increaseUnreadCount(payload.type, payload.peerId)
      this.enqueueCachedMessagesUpdate(payload.type, payload.peerId, (cached) => mergeMessages(cached, [payload.message])).catch(() => {})
      return
    }
    if (payload.message.direction === 'incoming' && (!this.visible || !this.state.trackingMessages)) {
      this.increaseUnreadCount(payload.type, payload.peerId)
    }
    this.appendMessage(payload.message)
    this.saveCachedMessages(payload.type, payload.peerId, this.state.messages).catch(() => {})
  }

  private handleRecall(payload: WebQQRecallPayload) {
    const shouldIncreaseUnread = payload.mode === 'remove'
      && payload.eventMessage?.direction === 'incoming'
      && (!this.visible || !this.state.trackingMessages)
    if (!this.isCurrentChat(payload)) {
      if (shouldIncreaseUnread) this.increaseUnreadCount(payload.type, payload.peerId)
      this.enqueueCachedMessagesUpdate(payload.type, payload.peerId, (cached) => applyWebQQRecallToMessages(cached, payload)).catch(() => {})
      return
    }
    if (shouldIncreaseUnread) this.increaseUnreadCount(payload.type, payload.peerId)
    const messages = applyWebQQRecallToMessages(this.state.messages, payload)
    this.commit({ messages })
    const latest = messages.at(-1)
    if (latest) this.updateConversationSummary(payload.type, payload.peerId, latest)
    this.saveCachedMessages(payload.type, payload.peerId, messages).catch(() => {})
  }

  // ── 发送 ─────────────────────────────────────────────────────────────

  /** 输入区只产出可发送内容；会话、回复目标、发送请求、错误文案与发送锁留在这里。 */
  sendCurrentWebQQMessage = async (
    buildElements: () => Promise<WebQQSendElement[]>,
    complete: (result: WebQQComposerSubmitResult) => void,
  ) => {
    const chat = this.state.currentChat
    if (!chat || this.state.sendingWebQQMessage) {
      complete({ sent: false, restoreFocus: false })
      return
    }
    // 捕获发送发起时的会话；异步期间切换会话时，不能把焦点错误地抢到新会话输入区。
    const requestChatKey = chatKeyOf(chat)
    this.commit({ sendingWebQQMessage: true, errorText: '' })
    let sent = false
    try {
      // 附件转字节也在这个 try 里：读文件失败与发送失败共用同一句错误文案。
      await sendWebQQMessage({
        type: chat.type,
        peerId: chat.peerId,
        elements: await buildElements(),
        ...(this.state.replyingToMessageId ? { replyToMessageId: this.state.replyingToMessageId } : {}),
      })
      sent = true
      this.clearReplyTarget()
    } catch (error) {
      this.commit({ errorText: readWebQQErrorMessage(error, tr('webqq.error.send')) })
    } finally {
      this.commit({ sendingWebQQMessage: false })
      complete({ sent, restoreFocus: chatKeyOf(this.state.currentChat) === requestChatKey })
    }
  }

  mentionCandidates(): WebQQMentionCandidate[] {
    if (this.state.currentChat?.type !== 'group') return []
    return this.state.groupInfo.members.map((member) => {
      const name = getGroupMemberName(member)
      const keywords = [member.nickname, member.card].filter((value): value is string => !!value && value !== name)
      return { id: member.userId, name, avatar: member.avatar, ...(keywords.length ? { keywords } : {}) }
    })
  }

  clearMentionRequest = () => {
    this.commit({ composerMentionRequest: undefined })
  }

  // ── 多选、回复与贴表情 ───────────────────────────────────────────────

  private async runInteraction(action: () => Promise<unknown>, fallback: string) {
    this.commit({ errorText: '' })
    try {
      await action()
      return true
    } catch (error) {
      this.commit({ errorText: readWebQQErrorMessage(error, fallback) })
      return false
    }
  }

  private isSelectableMessageId(messageId: string) {
    const message = this.visibleMessages().find((item) => item.id === messageId)
    return !!message && !message.event && !message.recalled
  }

  enterSelection = (messageId: string) => {
    if (!this.isSelectableMessageId(messageId)) return
    this.commit({ selectionMode: true, selectedMessageIds: [messageId], replyingToMessageId: '', reactionPickerMessageId: '' })
  }

  toggleSelection = (messageId: string) => {
    if (!this.state.selectionMode || !this.isSelectableMessageId(messageId)) return
    const ids = this.state.selectedMessageIds
    this.commit({ selectedMessageIds: ids.includes(messageId) ? ids.filter((id) => id !== messageId) : [...ids, messageId] })
  }

  exitSelection = () => {
    this.commit({ selectionMode: false, selectedMessageIds: [], forwardTargetOpen: false })
  }

  setReplyTarget = (messageId: string) => {
    if (this.state.selectionMode) return
    this.commit({ replyingToMessageId: messageId })
  }

  clearReplyTarget = () => {
    if (this.state.replyingToMessageId) this.commit({ replyingToMessageId: '' })
  }

  replyingToMessage() {
    const id = this.state.replyingToMessageId
    return id ? this.visibleMessages().find((message) => message.id === id) : undefined
  }

  openReactionPicker = (messageId: string) => {
    if (this.state.selectionMode) return
    this.commit({ reactionPickerMessageId: messageId })
  }

  setReactionPickerOpen = (open: boolean) => {
    if (!open) this.commit({ reactionPickerMessageId: '' })
  }

  selectReaction = (emojiId: string) => {
    const messageId = this.state.reactionPickerMessageId
    if (!messageId) return
    this.handleSetMessageReaction(messageId, emojiId, true)
    this.commit({ reactionPickerMessageId: '' })
  }

  handleSetMessageReaction = (messageId: string, emojiId: string, enabled: boolean) => {
    const chat = this.state.currentChat
    if (!chat) return
    void this.runInteraction(async () => {
      await setWebQQMessageReaction({ type: chat.type, peerId: chat.peerId, messageId, emojiId, enabled })
      // 部分 OneBot 实现执行成功却不回推自身 reaction notice；先本地提交，后续事件仍可按消息键合并校正。
      this.commit({ messages: applyLocalWebQQReaction(this.state.messages, messageId, emojiId, this.currentOperatorId, enabled) })
      await this.saveCachedMessages(chat.type, chat.peerId, this.state.messages)
    }, enabled ? tr('webqq.error.react') : tr('webqq.error.unreact'))
  }

  handleRecallMessage = (messageId: string) => {
    const chat = this.state.currentChat
    if (!chat) return
    void this.runInteraction(async () => {
      await recallWebQQMessage({ type: chat.type, peerId: chat.peerId, messageId })
      // delete_msg 成功也不保证实现回推自身撤回事件；立即标记，避免 UI 长时间保留可操作的旧消息。
      this.commit({ messages: applyLocalWebQQRecall(this.state.messages, chat.type, chat.peerId, messageId) })
      await this.saveCachedMessages(chat.type, chat.peerId, this.state.messages)
    }, tr('webqq.error.recall'))
  }

  // ── 合并转发 ─────────────────────────────────────────────────────────

  handleSelectionForward = () => {
    if (!this.state.currentChat || !this.state.selectedMessageIds.length) return
    this.commit({ forwardTargetOpen: true })
  }

  setForwardTargetOpen = (forwardTargetOpen: boolean) => {
    this.commit({ forwardTargetOpen })
  }

  forwardTargets(): WebQQForwardTargetModel {
    const toTarget = (type: 'friend' | 'group', peerId: string, title: string, subtitle?: string, avatar?: string): WebQQForwardTargetOption => (
      { id: `${type}:${peerId}`, type, peerId, title, subtitle, avatar }
    )
    return {
      recent: this.recentItems().map((item) => toTarget(item.type, item.peerId, item.name, item.subtitle, item.avatar)),
      friends: this.state.contacts.friends.map((friend) => toTarget('friend', friend.userId, friend.name, friend.nickname, friend.avatar)),
      groups: this.state.contacts.groups.map((group) => toTarget('group', group.groupId, group.name, getGroupSubtitle(group), group.avatar)),
    }
  }

  confirmSelectionForward = async (target: WebQQForwardTargetOption) => {
    await sendWebQQForward({ type: target.type, peerId: target.peerId, messageIds: [...this.state.selectedMessageIds] })
    this.exitSelection()
  }

  /** 打开结构化合并转发浮层。 */
  openForwardDialog = (element: WebQQMessageElement) => {
    if (!element.items?.length) return
    this.commit({ forwardDialog: element, noticeOpen: false })
  }

  closeForwardDialog = () => {
    if (this.state.forwardDialog) this.commit({ forwardDialog: undefined })
  }

  // ── 图片预览 ─────────────────────────────────────────────────────────

  openImagePreview = (url: string) => {
    this.commit({ imagePreviewUrl: url })
  }

  closeImagePreview = () => {
    this.commit({ imagePreviewUrl: '' })
  }

  // ── 资料卡 ───────────────────────────────────────────────────────────

  setProfileCardOpen = (profileCardOpen: boolean) => {
    this.commit({ profileCardOpen })
  }

  openCurrentChatProfile = async (event?: MouseEvent) => {
    const chat = this.state.currentChat
    if (!chat) return
    if (event) rememberFloatingPanelAnchor(event)
    if (chat.type === 'group') {
      const group = this.state.contacts.groups.find((item) => item.groupId === chat.peerId)
      if (!group) return
      this.commit({ profileCardModel: buildGroupProfileCardModel(group, this.state.groupInfo.members.length || undefined), profileCardOpen: true })
      return
    }
    await this.openUserProfile(chat.peerId, event)
  }

  openUserProfile = async (userId: string, event?: MouseEvent) => {
    if (event) rememberFloatingPanelAnchor(event)
    const chat = this.state.currentChat
    const friend = this.state.contacts.friends.find((item) => item.userId === userId)
    const member = this.state.groupInfo.members.find((item) => item.userId === userId)
    const group = chat?.type === 'group' ? this.state.contacts.groups.find((item) => item.groupId === chat.peerId) : undefined
    const message = this.visibleMessages().find((item) => item.senderId === userId)
    // 先展示本地可拼装资料，再覆盖真实请求结果；失败时保留本地卡并显示真实错误。
    this.commit({
      profileCardModel: buildUserProfileCardModel({
        userId,
        name: member ? getGroupMemberName(member) : friend?.name || message?.senderName || userId,
        avatar: member?.avatar || friend?.avatar || message?.senderAvatar,
        isFriend: !!friend,
        remark: friend && friend.name !== friend.nickname ? friend.name : undefined,
        friend,
        group,
        member,
      }),
      profileCardOpen: true,
      errorText: '',
    })
    try {
      const profile = await requestWebQQProfile({ userId, ...(chat?.type === 'group' ? { groupId: chat.peerId } : {}) })
      this.commit({ profileCardModel: buildProfileCardModelFromProfile(profile) })
    } catch (error) {
      this.commit({ errorText: readWebQQErrorMessage(error, tr('webqq.error.loadProfile')) })
    }
  }

  openContactProfile = (type: 'friend' | 'group', peerId: string) => {
    if (type === 'friend') {
      void this.openUserProfile(peerId)
      return
    }
    const group = this.state.contacts.groups.find((item) => item.groupId === peerId)
    if (!group) return
    this.commit({ profileCardModel: buildGroupProfileCardModel(group), profileCardOpen: true })
  }

  handleSaveSelfProfile = async (input: { nickname?: string, personalNote?: string, sex?: string, avatar?: string }) => {
    return this.runInteraction(async () => {
      await updateWebQQSelfProfile(input)
      const participantId = this.state.profileCardModel?.participantId
      if (!participantId) return
      this.commit({ profileCardModel: buildProfileCardModelFromProfile(await requestWebQQProfile({ userId: participantId })) })
    }, tr('webqq.error.updateProfile'))
  }

  // ── 输入与确认对话框（原 useWebQQActionDialogs） ─────────────────────

  private reportActionFailure = (error: unknown) => {
    this.commit({ errorText: readWebQQErrorMessage(error, tr('webqq.error.action')) })
  }

  /** 置为关闭就清掉 spec：取消、Escape、点遮罩三条关闭路径都自动清掉提交回调。 */
  setActionDialogOpen = (open: boolean) => {
    if (!open) this.commit({ actionDialogSpec: undefined })
  }

  setConfirmDialogOpen = (open: boolean) => {
    if (!open) this.commit({ confirmDialogSpec: undefined })
  }

  private openActionDialog(spec: WebQQActionDialogSpec) {
    this.commit({ actionDialogSpec: spec })
  }

  private openConfirmDialog(spec: WebQQConfirmDialogSpec) {
    this.commit({ confirmDialogSpec: spec })
  }

  /** 输入型协议：先关，再跑动作，失败只落到共享的错误横幅上。 */
  confirmActionDialog = (value: string) => {
    const spec = this.state.actionDialogSpec
    this.commit({ actionDialogSpec: undefined })
    void Promise.resolve(spec?.submit(value)).catch(this.reportActionFailure)
  }

  /** 确认型协议：组件自持提交态并等这一轮，成功才清 spec，失败时 spec 留在原地供重试。 */
  confirmDestructiveAction = async () => {
    const spec = this.state.confirmDialogSpec
    try {
      await spec?.submit()
      this.commit({ confirmDialogSpec: undefined })
    } catch (error) {
      this.reportActionFailure(error)
      throw error
    }
  }

  // ── 好友与群操作 ─────────────────────────────────────────────────────

  handlePokeFriend = (userId: string) => {
    const chat = this.state.currentChat
    const targetId = chat?.type === 'friend' ? chat.peerId : userId
    if (!targetId || targetId === this.currentOperatorId) return
    void this.runInteraction(() => performWebQQFriendAction({ action: 'poke', targetId }), tr('webqq.error.pokeFriend'))
  }

  openRemarkDialog = (userId: string) => {
    const friend = this.state.contacts.friends.find((item) => item.userId === userId)
    this.openActionDialog({
      title: tr('webqq.dialog.remark.title'),
      description: tr('webqq.dialog.remark.description'),
      placeholder: tr('webqq.dialog.remark.placeholder'),
      value: friend && friend.name !== friend.nickname ? friend.name : '',
      submit: async (remark) => {
        await performWebQQFriendAction({ action: 'set-remark', targetId: userId, remark })
        await this.loadContacts()
      },
    })
  }

  confirmDeleteFriend = (userId: string) => {
    const friend = this.state.contacts.friends.find((item) => item.userId === userId)
    this.openConfirmDialog({
      title: tr('webqq.dialog.deleteFriend.title'),
      description: tr('webqq.dialog.deleteFriend.description', { name: friend?.name || userId }),
      confirmText: tr('webqq.dialog.deleteFriend.confirm'),
      submit: async () => {
        await performWebQQFriendAction({ action: 'delete', targetId: userId })
        await this.loadContacts()
      },
    })
  }

  confirmLeaveGroup = (groupId: string) => {
    const group = this.state.contacts.groups.find((item) => item.groupId === groupId)
    this.openConfirmDialog({
      title: tr('webqq.dialog.leaveGroup.title'),
      description: tr('webqq.dialog.leaveGroup.description', { name: group?.name || groupId }),
      confirmText: tr('webqq.dialog.leaveGroup.confirm'),
      submit: async () => {
        await performWebQQGroupAction({ action: 'leave', groupId })
        await this.loadContacts()
      },
    })
  }

  handleMentionGroupMember = (userId: string) => {
    if (!this.config.enableWebQQSend) {
      this.commit({ errorText: tr('webqq.error.sendDisabled') })
      return
    }
    if (this.state.currentChat?.type !== 'group') {
      this.commit({ errorText: tr('webqq.error.notGroup') })
      return
    }
    const member = this.state.groupInfo.members.find((item) => item.userId === userId)
    // 右键提及与键入 @ 必须进入同一 token 草稿；否则两条入口会产生不同的顺序、删除和序列化行为。
    this.commit({ composerMentionRequest: { id: userId, name: member ? getGroupMemberName(member) : userId } })
  }

  private currentGroupId() {
    const chat = this.state.currentChat
    return chat?.type === 'group' ? chat.peerId : ''
  }

  private async refreshCurrentGroupMember(groupId: string, userId: string, patch: WebQQGroupMemberPatch) {
    this.patchGroupMember(groupId, userId, patch)
    if (this.currentGroupId() === groupId) await this.loadGroupInfo()
  }

  handlePokeGroupMember = (userId: string) => {
    const chat = this.state.currentChat
    if (chat?.type !== 'group') {
      this.commit({ errorText: tr('webqq.error.notGroup') })
      return
    }
    void this.runInteraction(() => performWebQQGroupAction({ action: 'poke', groupId: chat.peerId, targetId: userId }), tr('webqq.error.pokeMember'))
  }

  openGroupCardDialog = (userId: string) => {
    const member = this.state.groupInfo.members.find((item) => item.userId === userId)
    this.openActionDialog({
      title: tr('webqq.dialog.groupCard.title'),
      description: tr('webqq.dialog.groupCard.description'),
      placeholder: tr('webqq.dialog.groupCard.placeholder'),
      value: member?.card || '',
      submit: async (card) => {
        const chat = this.state.currentChat
        if (chat?.type !== 'group') throw new Error(tr('webqq.error.notGroup'))
        await performWebQQGroupAction({ action: 'set-card', groupId: chat.peerId, targetId: userId, card })
        await this.refreshCurrentGroupMember(chat.peerId, userId, { card })
      },
    })
  }

  openGroupTitleDialog = (userId: string) => {
    const member = this.state.groupInfo.members.find((item) => item.userId === userId)
    this.openActionDialog({
      title: tr('webqq.dialog.groupTitle.title'),
      description: tr('webqq.dialog.groupTitle.description'),
      placeholder: tr('webqq.dialog.groupTitle.placeholder'),
      value: member?.title || '',
      submit: async (title) => {
        const chat = this.state.currentChat
        if (chat?.type !== 'group') throw new Error(tr('webqq.error.notGroup'))
        await performWebQQGroupAction({ action: 'set-title', groupId: chat.peerId, targetId: userId, title })
        await this.refreshCurrentGroupMember(chat.peerId, userId, { title })
      },
    })
  }

  handleSetGroupAdmin = (userId: string, enabled: boolean) => {
    const chat = this.state.currentChat
    if (chat?.type !== 'group') {
      this.commit({ errorText: tr('webqq.error.notGroup') })
      return
    }
    void this.runInteraction(async () => {
      await performWebQQGroupAction({ action: 'set-admin', groupId: chat.peerId, targetId: userId, enabled })
      await this.refreshCurrentGroupMember(chat.peerId, userId, {
        role: enabled ? '管理员' : '成员',
        rawRole: enabled ? 'admin' : 'member',
      })
    }, enabled ? tr('webqq.error.setAdmin') : tr('webqq.error.unsetAdmin'))
  }

  handleKickGroupMember = (userId: string) => {
    const chat = this.state.currentChat
    if (chat?.type !== 'group') {
      this.commit({ errorText: tr('webqq.error.notGroup') })
      return
    }
    const member = this.state.groupInfo.members.find((item) => item.userId === userId)
    this.openConfirmDialog({
      title: tr('webqq.dialog.kick.title'),
      description: tr('webqq.dialog.kick.description', { name: member ? getGroupMemberName(member) : userId }),
      confirmText: tr('webqq.dialog.kick.confirm'),
      submit: async () => {
        await performWebQQGroupAction({ action: 'kick', groupId: chat.peerId, targetId: userId })
        if (this.currentGroupId() === chat.peerId) await this.loadGroupInfo()
      },
    })
  }

  // ── 群信息（原 useWebQQGroupInfo） ───────────────────────────────────

  visibleGroupMembers() {
    return getVisibleGroupMembers(this.state.groupInfo.members, this.state.groupInfoSearchQuery)
  }

  setGroupInfoSearchQuery(groupInfoSearchQuery: string) {
    this.commit({ groupInfoSearchQuery })
  }

  private applyPendingGroupMemberPatches(groupId: string, info: WebQQGroupInfo) {
    const patches = this.groupMemberPatches[groupId]
    if (!patches) return info
    let changed = false
    const members = info.members.map((member) => {
      const patch = patches[member.userId]
      if (!patch) return member
      const unresolved: WebQQGroupMemberPatch = {}
      for (const field of groupMemberPatchFields) {
        const value = patch[field]
        if (value !== undefined && member[field] !== value) Object.assign(unresolved, { [field]: value })
      }
      if (!Object.keys(unresolved).length) {
        delete patches[member.userId]
        return member
      }
      patches[member.userId] = unresolved
      changed = true
      return { ...member, ...unresolved }
    })
    if (!Object.keys(patches).length) delete this.groupMemberPatches[groupId]
    // OneBot 的写接口成功与成员列表缓存失效并不总是同步；保留尚未被读接口确认的字段，避免界面回退。
    return changed ? { ...info, members } : info
  }

  async loadGroupInfo() {
    const groupId = this.currentGroupId()
    if (!groupId) return
    const requestToken = (this.groupInfoRequestTokens[groupId] || 0) + 1
    this.groupInfoRequestTokens[groupId] = requestToken
    const isLatest = () => this.groupInfoRequestTokens[groupId] === requestToken
    this.commit({
      groupInfo: Object.hasOwn(this.groupInfoCache, groupId) ? this.groupInfoCache[groupId]! : emptyGroupInfo(),
      groupInfoLoading: true,
      groupInfoErrorText: '',
    })
    try {
      const requested = await requestWebQQGroupInfo(groupId)
      if (!isLatest()) return
      const groupInfo = this.applyPendingGroupMemberPatches(groupId, requested)
      this.groupInfoCache[groupId] = groupInfo
      // 群信息刷新可能跨越快速切群，只有当前群仍匹配时才替换页面数据。
      if (this.currentGroupId() === groupId) this.commit({ groupInfo })
    } catch (error) {
      if (isLatest() && this.currentGroupId() === groupId) {
        this.commit({ groupInfoErrorText: readWebQQErrorMessage(error, tr('webqq.error.loadGroupInfo')) })
      }
    } finally {
      if (isLatest() && this.currentGroupId() === groupId) this.commit({ groupInfoLoading: false })
    }
  }

  private patchGroupMember(groupId: string, userId: string, patch: WebQQGroupMemberPatch) {
    const isCurrent = this.currentGroupId() === groupId
    const source = isCurrent ? this.state.groupInfo : this.groupInfoCache[groupId]
    if (!source?.members.some((member) => member.userId === userId)) return
    this.groupMemberPatches[groupId] = {
      ...this.groupMemberPatches[groupId],
      [userId]: { ...this.groupMemberPatches[groupId]?.[userId], ...patch },
    }
    const groupInfo = {
      ...source,
      members: source.members.map((member) => member.userId === userId ? { ...member, ...patch } : member),
    }
    this.groupInfoCache[groupId] = groupInfo
    if (isCurrent) this.commit({ groupInfo })
  }

  toggleGroupInfo = () => {
    const groupInfoOpen = !this.state.groupInfoOpen
    this.commit({ groupInfoOpen })
    if (groupInfoOpen) void this.loadGroupInfo()
  }

  // ── 通知（原 useWebQQNotices） ───────────────────────────────────────

  filteredNotices(): WebQQNotice[] {
    const tab = this.state.noticeMenuTab
    return sortPendingNotices(this.state.notices.filter((notice) => tab === 'friends' ? notice.type === 'friend-request' : notice.type === 'group-notice'))
  }

  setNoticeMenuTab = (noticeMenuTab: WebQQNoticeTab) => {
    this.commit({ noticeMenuTab })
  }

  private async loadNotices() {
    this.commit({ noticeLoading: true, noticeErrorText: '' })
    try {
      this.commit({ notices: await requestWebQQNotices() })
    } catch (error) {
      this.commit({ noticeErrorText: readWebQQErrorMessage(error, tr('webqq.error.loadNotices')) })
    } finally {
      this.commit({ noticeLoading: false })
    }
  }

  openNotices = () => {
    const noticeOpen = !this.state.noticeOpen
    this.commit({ noticeOpen })
    if (noticeOpen) void this.loadNotices()
  }

  closeNoticeMenu = () => {
    if (this.state.noticeOpen) this.commit({ noticeOpen: false })
    this.closeForwardDialog()
  }

  handleNotice = async (notice: WebQQNotice, approve: boolean) => {
    if (!hasNoticeFlag(notice)) return
    this.commit({ handlingNoticeId: notice.id, noticeErrorText: '' })
    try {
      await approveWebQQNotice(notice, approve)
      await this.loadNotices()
    } catch (error) {
      this.commit({ noticeErrorText: readWebQQErrorMessage(error, tr('webqq.error.handleNotice')) })
    } finally {
      this.commit({ handlingNoticeId: '' })
    }
  }

  // ── 查找聊天记录（原 useWebQQMessageSearch） ─────────────────────────

  private resetMessageSearchResults(): Partial<WebQQState> {
    this.nextBeforeSequence = ''
    return {
      messageSearchResults: [],
      messageSearchErrorText: '',
      messageSearchSearched: false,
      messageSearchExhausted: true,
    }
  }

  /** 一次查找从头到尾要跨两个 await；两者之间既可能换了查找条件，也可能切走了会话。 */
  private isCurrentSearch(serial: number, expectedChatKey: string) {
    return serial === this.messageSearchSerial && chatKeyOf(this.state.currentChat) === expectedChatKey
  }

  openMessageSearch = () => {
    if (!this.state.currentChat) return
    this.commit({ messageSearchOpen: true, ...this.resetMessageSearchResults() })
  }

  closeMessageSearch = () => {
    if (!this.state.messageSearchOpen) return
    this.messageSearchSerial++
    this.commit({
      messageSearchOpen: false,
      messageSearchLoading: false,
      messageSearchQuery: '',
      messageSearchLocalDate: '',
      ...this.resetMessageSearchResults(),
    })
    this.restoreSearchTriggerFocus()
  }

  setMessageSearchQuery = (messageSearchQuery: string) => {
    this.commit({ messageSearchQuery })
  }

  setMessageSearchLocalDate = (messageSearchLocalDate: string) => {
    this.commit({ messageSearchLocalDate })
  }

  private async runMessageSearch(more: boolean, criteria?: { query: string, localDate?: string }) {
    const chat = this.state.currentChat
    if (!chat) return
    if (!more && criteria) this.commit({ messageSearchQuery: criteria.query, messageSearchLocalDate: criteria.localDate || '' })
    const keyword = this.state.messageSearchQuery.trim()
    const dateRange = localDateToMessageSearchRange(this.state.messageSearchLocalDate)
    if (!keyword && !dateRange) {
      this.commit(this.resetMessageSearchResults())
      return
    }
    const expectedChatKey = chatKeyOf(chat)
    const serial = ++this.messageSearchSerial
    this.commit({ messageSearchLoading: true, messageSearchErrorText: '', ...(more ? {} : this.resetMessageSearchResults()) })
    let localMatches: WebQQMessage[] = []
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    try {
      // 浏览器存储的消息缓存只在前端，当前会话内存里的消息也可能比上次落盘更新：首搜先并入这些本地命中。
      if (!more) {
        const cached = await this.loadCachedMessages(chat.type, chat.peerId)
        // 期间切走会话时这批本地命中已经作废，也不该再发查询：服务端会真的向 OneBot 翻最多 10 页历史。
        if (!this.isCurrentSearch(serial, expectedChatKey)) return
        localMatches = filterWebQQSearchMessages(mergeMessages(cached, this.state.messages), { keyword, ...dateRange })
        // 有本地命中就先上屏，避免 OneBot 历史接口卡住时界面一直停在「搜索中」。
        if (localMatches.length) this.commit({ messageSearchResults: localMatches, messageSearchSearched: true })
      }
      const result = await Promise.race([
        searchWebQQMessages({
          type: chat.type,
          peerId: chat.peerId,
          keyword,
          ...dateRange,
          ...(more && this.nextBeforeSequence ? { beforeSequence: this.nextBeforeSequence } : {}),
        }),
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => reject(new Error(tr('webqq.error.searchTimeout'))), MESSAGE_SEARCH_TIMEOUT_MS)
        }),
      ])
      if (!this.isCurrentSearch(serial, expectedChatKey)) return
      this.nextBeforeSequence = result.nextBeforeSequence || ''
      this.commit({
        messageSearchResults: more
          ? mergeMessages(result.messages, this.state.messageSearchResults)
          : mergeMessages(localMatches, result.messages),
        messageSearchExhausted: result.exhausted,
        messageSearchSearched: true,
      })
    } catch (error) {
      if (!this.isCurrentSearch(serial, expectedChatKey)) return
      // 本地命中已经上屏时，远端那半失败不该把它们换成一条错误文案。
      this.commit({
        ...(localMatches.length ? {} : { messageSearchErrorText: readWebQQErrorMessage(error, tr('webqq.error.search')) }),
        messageSearchSearched: true,
      })
    } finally {
      clearTimeout(timeoutTimer)
      // 只查序号：有更新的查找接手时不该动；会话切走却没有更新的查找接手时，这次查找仍占着 loading，必须放下。
      if (serial === this.messageSearchSerial) this.commit({ messageSearchLoading: false })
    }
  }

  searchMessages = (criteria: { query: string, localDate?: string }) => {
    void this.runMessageSearch(false, criteria)
  }

  searchMoreMessages = () => {
    void this.runMessageSearch(true)
  }

  selectSearchResult = async (message: WebQQMessage) => {
    const chat = this.state.currentChat
    if (!chat) return
    this.commit({ messages: mergeMessages(this.state.messages, [message]) })
    this.rememberMessageSenderMetadata(chat.type, chat.peerId, [message])
    // 命中并进消息列表后必须先渲染出来才能滚过去。
    await this.nextTick()
    this.scrollToMessage(message.id || message.sequence)
  }

  // ── Escape 的处理次序（原观察窗的 handleSelectionKeydown） ───────────

  handleEscape(): boolean {
    if (this.state.messageSearchOpen) {
      this.closeMessageSearch()
      return true
    }
    if (this.state.forwardTargetOpen) {
      this.commit({ forwardTargetOpen: false })
      return true
    }
    if (this.state.selectionMode) {
      this.exitSelection()
      return true
    }
    if (this.state.replyingToMessageId) {
      this.clearReplyTarget()
      return true
    }
    return false
  }
}
