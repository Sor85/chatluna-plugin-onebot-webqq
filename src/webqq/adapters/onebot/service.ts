import {
  getActionData,
  getStringField,
  isRecord,
  toArrayResult,
  toOneBotId,
  toTimestampMs,
} from '../../../onebot/data'
import { readConfigDefault } from '../../../config/spec'
import { resolveOneBotEmojiType } from '../../../onebot/emoji'
import {
  callAction,
  callSupportedAction,
  supportsOneBotAction,
  type OneBotBot,
} from '../../../onebot/actions'
import {
  getAvailableOneBotBots,
  getOneBotBots,
  getOneBotProfileStatus,
  getProbeableOneBotBots,
  oneBotProbeAction,
  selectBot,
  type OneBotContext,
} from '../../../onebot/bots'
import { readOneBotAvatarScope } from './avatar-scope'
import { getTextValue } from './text'
import { normalizeGroupNotices } from './notices'
import {
  normalizeGroupAnnouncement,
  normalizeGroupMember,
} from './group-info'
import {
  getRecentPeerType,
  normalizeFriend,
  normalizeFriendCategory,
  normalizeGroup,
  oneBotAvatarFields,
} from './contacts'
import {
  resolveOneBotImage,
} from '../../../onebot/media/images'
import {
  resolveOneBotRecord,
  transcribeOneBotRecord,
} from '../../../onebot/media/records'
import {
  normalizeMessage,
  normalizeMessageElements,
  resolveOneBotForward,
  resolveOneBotQuote,
  summarizeElements,
} from './messages'
import type {
  OneBotWebQQOptions,
  OneBotRobotProfile,
  OneBotRobotState,
} from '../../../onebot/types'
import {
  getWebQQGroupSubtitle,
  readWebQQProvidedAvatar,
  resolveWebQQGroupAvatar,
  resolveWebQQUserAvatar,
  type WebQQAvatarScope,
} from '../../display'
import type {
  WebQQContacts,
  WebQQForwardSendInput,
  WebQQFriend,
  WebQQFriendAction,
  WebQQGroup,
  WebQQGroupAction,
  WebQQGroupInfo,
  WebQQGroupInfoQuery,
  WebQQMessage,
  WebQQMessageQuery,
  WebQQMessageReactionInput,
  WebQQMessageRecallInput,
  WebQQRecordTranscriptionQuery,
  WebQQMessageReactionUser,
  WebQQNotice,
  WebQQNoticeAction,
  WebQQProfile,
  WebQQProfileField,
  WebQQProfileQuery,
  WebQQRecentContact,
  WebQQSelfProfileUpdate,
  WebQQSendElement,
  WebQQSendPayload,
} from '../../types'

function getOneBotStatusName(status: unknown) {
  switch (status) {
    case 0: return 'OFFLINE'
    case 1: return 'ONLINE'
    case 2: return 'CONNECT'
    case 3: return 'DISCONNECT'
    case 4: return 'RECONNECT'
    default: return typeof status === 'number' ? `UNKNOWN_${status}` : 'UNSET'
  }
}

function getBotDisplayName(bot: OneBotBot) {
  const name = (bot.name || bot.username || bot.user?.name || bot.user?.nick || bot.user?.username || bot.user?.nickname || '').trim()
  if (name && name !== bot.selfId) return name
  return '机器人'
}

function toOneBotRobotProfile(bot: OneBotBot, activeSelfIds?: ReadonlySet<string>): OneBotRobotProfile | undefined {
  if (!bot.selfId) return
  return {
    platform: bot.platform || 'onebot',
    selfId: bot.selfId,
    status: getOneBotProfileStatus(bot, activeSelfIds),
    name: getBotDisplayName(bot),
    // 提供方插件给的可能是它自己的媒体引用，进不了 <img>；那种取值当作没有头像，交给界面的首字母占位。
    avatar: readWebQQProvidedAvatar(bot.avatar)
      || resolveWebQQUserAvatar(bot.user?.avatar, bot.selfId, readOneBotAvatarScope(bot)),
  }
}

function getMockBotCount(value: number | undefined) {
  return Math.max(0, Math.min(20, Math.floor(value ?? 0)))
}

function getMockSelfId(sourceSelfId: string, index: number) {
  return `${sourceSelfId}:mock:${index + 1}`
}

function getMockBotSourceSelfId(selfId: string) {
  return selfId.match(/^(.*):mock:\d+$/)?.[1]
}

function createMockBotProfiles(bots: OneBotRobotProfile[], count: number): OneBotRobotProfile[] {
  const source = bots[0]
  if (!source || !count) return []
  return Array.from({ length: count }, (_, index) => ({
    ...source,
    selfId: getMockSelfId(source.selfId, index),
    name: `${source.name} 模拟 ${index + 1}`,
  }))
}

async function normalizeRecentContact(raw: unknown, bot: OneBotBot, friends: WebQQFriend[], groups: WebQQGroup[], imageUrlResolver?: (file: string) => string): Promise<WebQQRecentContact | undefined> {
  const scope = readOneBotAvatarScope(bot)
  const item = isRecord(raw) ? raw : {}
  const peerId = getStringField(item, ['peerUin', 'peer_uin', 'uin', 'user_id', 'group_id'])
  if (!peerId) return
  const type = getRecentPeerType(item, peerId, groups)
  const friend = type === 'friend' ? friends.find((value) => value.userId === peerId) : undefined
  const group = type === 'group' ? groups.find((value) => value.groupId === peerId) : undefined
  const rawName = getStringField(item, ['remark', 'peerName', 'peer_name', 'name', 'nick', 'nickname'])
  const message = isRecord(item.lastestMsg) ? item.lastestMsg : isRecord(item.latestMsg) ? item.latestMsg : undefined
  const elements = message ? await normalizeMessageElements(message.message, bot, imageUrlResolver) : []
  const summary = elements.length ? summarizeElements(elements) : getTextValue(item.lastestMsg) || getTextValue(item.latestMsg)
  const time = toTimestampMs(getStringField(item, ['msgTime', 'msg_time', 'time', 'timestamp']) || (message ? message.time : 0))
  return {
    type,
    peerId,
    name: friend?.name || group?.name || rawName || peerId,
    subtitle: friend?.nickname || (group ? getWebQQGroupSubtitle(group) : rawName || peerId),
    // 好友与群列表里的头像已经按同一规则解析过，优先沿用，避免同一个人在两处显示不同头像。
    avatar: friend?.avatar || group?.avatar || (type === 'friend'
      ? resolveWebQQUserAvatar(getStringField(item, oneBotAvatarFields), peerId, scope)
      : resolveWebQQGroupAvatar(getStringField(item, oneBotAvatarFields), peerId, scope)),
    summary,
    time,
  }
}

// NapCat 与 LLBot 的 action 清单里都只有 _get_group_notice，没有不带下划线的写法，
// 因此没有第二个名字可试。取不到公告不算错误：群本来就可能没有公告，群资料栏此时不显示公告区。
async function loadGroupAnnouncements(bot: OneBotBot, groupId: string) {
  try {
    const result = await callAction(bot, '_get_group_notice', { group_id: toOneBotId(groupId) })
    return toArrayResult(result, 'notices').map(normalizeGroupAnnouncement)
  } catch {
    return []
  }
}

function getContactLoadErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function loadRequiredContactData<T>(stage: string, loader: () => Promise<T>) {
  try {
    return await loader()
  } catch (error) {
    throw new Error(`${stage}失败：${getContactLoadErrorMessage(error)}`)
  }
}

async function loadFriendCategories(bot: OneBotBot) {
  const scope = readOneBotAvatarScope(bot)
  try {
    return toArrayResult(await callAction(bot, 'get_friends_with_category'), 'categories')
      .map((category, index) => normalizeFriendCategory(category, index, scope))
  } catch {
    return []
  }
}

async function loadRecentContacts(bot: OneBotBot, friends: WebQQFriend[], groups: WebQQGroup[], imageUrlResolver?: (file: string) => string) {
  try {
    const result = await callAction(bot, 'get_recent_contact', { count: 50 })
    const recent = await Promise.all(toArrayResult(result, 'contacts').map((item) => normalizeRecentContact(item, bot, friends, groups, imageUrlResolver)))
    return recent.filter((item): item is WebQQRecentContact => !!item)
  } catch {
    return []
  }
}

function normalizeEmojiLikeUser(raw: unknown, scope: WebQQAvatarScope): WebQQMessageReactionUser | undefined {
  const item = isRecord(raw) ? raw : {}
  const userId = getStringField(item, ['tinyId'])
  if (!userId) return
  const userName = getStringField(item, ['nickName', 'nickname', 'name'])
  return {
    userId,
    ...(userName ? { userName } : {}),
    userAvatar: resolveWebQQUserAvatar(getStringField(item, ['headUrl', ...oneBotAvatarFields]), userId, scope),
  }
}

function toOneBotVideoFile(data: string) {
  const dataUrl = /^data:[^;,]+;base64,(.*)$/.exec(data)
  // 浏览器侧保留 MIME 完整的 data URL 供本地预览；NapCat 与 LLBot 的视频段
  // 使用 base64://，因此只在 OneBot 边界剥离头部，避免被误判为本地文件路径。
  return dataUrl ? `base64://${dataUrl[1]}` : data
}

function toOneBotSendSegment(element: WebQQSendElement) {
  if (element.type === 'text' && element.text) {
    return { type: 'text', data: { text: element.text } }
  }
  if (element.type === 'image' && element.data) {
    return { type: 'image', data: { file: element.data } }
  }
  if (element.type === 'video' && element.data) {
    return {
      type: 'video',
      data: {
        file: toOneBotVideoFile(element.data),
        name: element.name || 'video.mp4',
      },
    }
  }
  if (element.type === 'file' && element.data) {
    return { type: 'file', data: { file: element.data, name: element.name || 'file' } }
  }
  if (element.type === 'quote' && (element.targetMessageId || element.data)) {
    return { type: 'reply', data: { id: element.targetMessageId || element.data || '' } }
  }
  if (element.type === 'at' && (element.userId || element.data)) {
    return { type: 'at', data: { qq: element.userId || element.data || '' } }
  }
  if (element.type === 'face' && (element.faceId || element.data)) {
    return { type: 'face', data: { id: element.faceId || element.data || '' } }
  }
}

// 发送类 action 返回的消息 ID。WebQQ 用它把刚发出的这条消息按 get_msg 读回来并回显——
// 不是所有 OneBot 实现都会回报自己发出的消息（NapCat 的 report-self-message 默认关闭）。
function readSentMessageId(result: unknown) {
  return getStringField(getActionData(result), ['message_id', 'messageId', 'msg_id', 'msgId', 'id'])
}

function pushProfileField(fields: WebQQProfileField[], group: string, label: string, value?: string) {
  const next = value?.trim()
  if (!next) return
  fields.push({ group, label, value: next })
}

function normalizeSexValue(value: unknown) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  if (raw === '1' || raw === 'male' || raw === '男') return 'male'
  if (raw === '2' || raw === 'female' || raw === '女') return 'female'
  if (raw === '0' || raw === 'unknown' || raw === '未知') return 'unknown'
  return String(value)
}

function toSnowLumaSex(value: string) {
  const sex = normalizeSexValue(value)
  if (sex === 'male') return 1
  if (sex === 'female') return 2
  return 0
}

function normalizeSexLabel(value: unknown) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  if (raw === '1' || raw === 'male' || raw === '男') return '男'
  if (raw === '2' || raw === 'female' || raw === '女') return '女'
  if (raw === '0' || raw === 'unknown' || raw === '未知') return '未知'
  return String(value)
}

// 创建通过 OneBot action 读写 WebQQ 数据的服务。
export function createOneBotWebQQService(ctx: OneBotContext, options: OneBotWebQQOptions = {}) {
  let selectedSelfId = options.selfId
  const recentBotActivity = new Map<string, number>()
  const getRecentlyActiveSelfIds = () => {
    const now = Date.now()
    for (const [selfId, timestamp] of recentBotActivity) {
      if (now - timestamp > 5 * 60 * 1000) recentBotActivity.delete(selfId)
    }
    return new Set(recentBotActivity.keys())
  }
  const getBotStatusDiagnostics = () => {
    const activeSelfIds = getRecentlyActiveSelfIds()
    const rawBots = (ctx.bots ?? []).map((value, index) => {
      if (!isRecord(value)) return { index, valueType: typeof value }
      const internal = isRecord(value.internal) ? value.internal : undefined
      const bot = internal ? value as unknown as OneBotBot : undefined
      return {
        index,
        platform: getStringField(value, ['platform']),
        selfId: getStringField(value, ['selfId', 'self_id']),
        status: typeof value.status === 'number' ? value.status : undefined,
        statusName: getOneBotStatusName(value.status),
        hidden: value.hidden === true,
        hasInternal: !!internal,
        hasRequest: typeof internal?._request === 'function',
        supportsAnyAction: bot ? supportsOneBotAction(bot) : false,
      }
    })
    const availableBots = getAvailableOneBotBots(ctx, options.selfIds, activeSelfIds, options).map((bot) => ({
      selfId: bot.selfId,
      status: bot.status,
      statusName: getOneBotStatusName(bot.status),
      recentlyActive: !!bot.selfId && activeSelfIds.has(bot.selfId),
    }))
    return {
      selectedSelfId,
      configuredSelfId: options.selfId,
      configuredSelfIds: options.selfIds,
      includeVirtualBots: !!options.includeVirtualBots,
      recentActiveSelfIds: [...activeSelfIds],
      rawBots,
      availableBots,
    }
  }
  const logBotStatus = (source: string, data: Record<string, unknown> = {}) => {
    options.logBotStatus?.(source, {
      ...data,
      diagnostics: getBotStatusDiagnostics(),
    })
  }
  let lastReconcileSignature = ''
  const getRealSelfId = (selfId = selectedSelfId) => {
    const sourceSelfId = selfId ? getMockBotSourceSelfId(selfId) : undefined
    return sourceSelfId || selfId
  }
  const getBot = (selfId = selectedSelfId) => selectBot(ctx, {
    ...options,
    selfId: getRealSelfId(selfId),
    activeSelfIds: getRecentlyActiveSelfIds(),
  })
  const listBots = () => {
    // 可用性覆盖与画像状态必须来自同一份活动快照，否则会出现「Bot 在列表里但指示灯离线」的矛盾。
    const activeSelfIds = getRecentlyActiveSelfIds()
    const bots = getAvailableOneBotBots(ctx, options.selfIds, activeSelfIds, options)
      .map((bot) => toOneBotRobotProfile(bot, activeSelfIds))
      .filter((bot): bot is OneBotRobotProfile => !!bot)
    // 派生画像只用于胶囊多机器人展示，动作经 getRealSelfId 落到首个机器人；模拟环境同样生效。
    return [
      ...bots,
      ...createMockBotProfiles(bots, getMockBotCount(options.mockBotCount)),
    ]
  }
  const reconcileBotState = (): OneBotRobotState => {
    const bots = listBots()
    if (!selectedSelfId || !bots.some((bot) => bot.selfId === selectedSelfId)) {
      selectedSelfId = bots[0]?.selfId
    }
    const state = {
      bots,
      ...(selectedSelfId ? { selectedSelfId } : {}),
    }
    const signature = JSON.stringify({
      selectedSelfId,
      bots: bots.map((bot) => [bot.selfId, bot.status]),
      diagnostics: getBotStatusDiagnostics(),
    })
    if (signature !== lastReconcileSignature) {
      lastReconcileSignature = signature
      logBotStatus('reconcile-change', {
        result: {
          selectedSelfId: state.selectedSelfId,
          bots: state.bots.map((bot) => ({
            selfId: bot.selfId,
            status: bot.status,
            statusName: getOneBotStatusName(bot.status),
          })),
        },
      })
    }
    return state
  }
  const protocol = options.protocol ?? readConfigDefault('onebotProtocol')
  const normalizeSnowLumaCursor = (message: WebQQMessage) => protocol === 'snowluma' && message.id ? { ...message, sequence: message.id } : message
  const { imageUrlResolver } = options
  const listAvailableSelfIds = () =>
    getAvailableOneBotBots(ctx, options.selfIds, getRecentlyActiveSelfIds(), options)
      .map((bot) => bot.selfId)
      .filter((selfId): selfId is string => !!selfId)
  let probeInFlight: Promise<boolean> | undefined
  // 主动探测 action 通道，替代「等一条外部消息才可用」。探测成功时复用与消息活动完全相同的
  // 覆盖机制（recentBotActivity），因此可用性语义与原来一致，只是不再依赖外部触发。
  const probeBotAvailability = async () => {
    const candidates = getProbeableOneBotBots(ctx, options.selfIds, options)
    if (!candidates.length) return false
    const before = new Set(listAvailableSelfIds())
    await Promise.all(candidates.map(async (bot) => {
      const selfId = bot.selfId
      if (!selfId) return
      try {
        await callAction(bot, oneBotProbeAction, {})
      } catch (error) {
        logBotStatus('probe-failed', {
          selfId,
          rawStatusName: getOneBotStatusName(bot.status),
          error: error instanceof Error ? error.message : String(error),
        })
        return
      }
      recentBotActivity.set(selfId, Date.now())
      logBotStatus('probe-succeeded', {
        selfId,
        rawStatusName: getOneBotStatusName(bot.status),
      })
    }))
    const after = listAvailableSelfIds()
    return after.length !== before.size || after.some((selfId) => !before.has(selfId))
  }
  return {
    getBotStatusDiagnostics() {
      return getBotStatusDiagnostics()
    },

    // 返回 true 表示可用 Bot 集合发生了变化，调用方需要广播新的 Bot 状态。
    probeBotAvailability() {
      // 探测走真实 action，慢实现下可能长时间悬挂；同一时刻只允许一次，避免定时器叠加请求。
      probeInFlight ??= probeBotAvailability().finally(() => {
        probeInFlight = undefined
      })
      return probeInFlight
    },

    noteBotActivity(selfId?: string) {
      const realSelfId = getRealSelfId(selfId)
      if (!realSelfId) {
        logBotStatus('message-activity', { selfId, action: 'skip-missing-self-id' })
        return
      }
      const bot = getOneBotBots(ctx, options).find((candidate) => candidate.selfId === realSelfId)
      if (bot?.status === 1) {
        recentBotActivity.delete(realSelfId)
        logBotStatus('message-activity', {
          selfId: realSelfId,
          rawStatus: bot.status,
          rawStatusName: getOneBotStatusName(bot.status),
          action: 'clear-online-override',
        })
        return
      }
      recentBotActivity.set(realSelfId, Date.now())
      logBotStatus('message-activity', {
        selfId: realSelfId,
        rawStatus: bot?.status,
        rawStatusName: getOneBotStatusName(bot?.status),
        action: 'set-recent-activity-override',
      })
    },

    getSelectedSelfId() {
      return selectedSelfId
    },

    isSelectedSelfId(selfId?: string) {
      if (!selectedSelfId) return true
      return !!selfId && getRealSelfId(selfId) === getRealSelfId(selectedSelfId)
    },

    isAvailableSelectedSelfId(selfId?: string) {
      const state = reconcileBotState()
      if (!selfId || !state.selectedSelfId) return false
      return getRealSelfId(selfId) === getRealSelfId(state.selectedSelfId)
    },

    reconcileBotState() {
      return reconcileBotState()
    },

    selectSelfId(selfId: string) {
      const bots = listBots()
      const selected = bots.find((bot) => bot.selfId === selfId)
      if (!selected) throw new Error(`未找到 selfId 为 ${selfId} 的 OneBot 机器人`)
      // 模拟 bot 只用于无多 bot 环境验证 UI，真实 WebQQ action 仍要落到源机器人。
      selectBot(ctx, { ...options, selfId: getRealSelfId(selfId) })
      selectedSelfId = selected.selfId
      return selectedSelfId
    },

    listBots() {
      return listBots()
    },

    async resolveQuote(id: string) {
      return resolveOneBotQuote(getBot(), id, imageUrlResolver)
    },

    async resolveForward(id: string) {
      return resolveOneBotForward(getBot(), id, imageUrlResolver)
    },

    async resolveMessage(id: string, selfId?: string) {
      const bot = getBot(selfId)
      return normalizeSnowLumaCursor(await normalizeMessage(getActionData(await callAction(bot, 'get_msg', { message_id: toOneBotId(id) })), bot, imageUrlResolver))
    },

    supportsReactionUsers(selfId?: string) {
      try {
        return supportsOneBotAction(getBot(selfId), 'fetch_emoji_like')
      } catch {
        return false
      }
    },

    async loadReactionUsers(messageId: string, emojiId: string, count: number, selfId?: string): Promise<WebQQMessageReactionUser[]> {
      const bot = getBot(selfId)
      const result = await callAction(bot, 'fetch_emoji_like', {
        message_id: toOneBotId(messageId),
        // NapCat 的 fetch_emoji_like 只认 camelCase 的 emojiId 且要求 emojiType，与它自己的
        // set_msg_emoji_like（snake_case emoji_id、不收类型）并不一致；LLBot 两种拼写都接受，
        // 并会丢弃它没声明的 emojiType。两种拼写连同类型一起带上，两种实现都能命中同一次查询。
        emoji_id: emojiId,
        emojiId,
        emojiType: resolveOneBotEmojiType(emojiId),
        count,
      })
      const scope = readOneBotAvatarScope(bot)
      return toArrayResult(result, 'emojiLikesList')
        .map((user) => normalizeEmojiLikeUser(user, scope))
        .filter((user): user is WebQQMessageReactionUser => !!user)
    },

    async resolveImage(file: string) {
      return resolveOneBotImage(getBot(), file, imageUrlResolver)
    },

    async resolveRecord(file: string) {
      return resolveOneBotRecord(getBot(), file, imageUrlResolver)
    },

    async transcribeRecord(messageId: WebQQRecordTranscriptionQuery['messageId']) {
      return transcribeOneBotRecord(getBot(), messageId, protocol)
    },

    async loadContacts(): Promise<WebQQContacts> {
      const bot = getBot()
      const avatarScope = readOneBotAvatarScope(bot)
      const [friendCategories, groupsResult] = await Promise.all([
        loadFriendCategories(bot),
        loadRequiredContactData('加载群列表', () => callAction(bot, 'get_group_list')),
      ])
      const friends = friendCategories.length
        ? friendCategories.flatMap((category) => category.friends)
        : toArrayResult(await loadRequiredContactData('加载好友列表', () => callAction(bot, 'get_friend_list')), 'friends')
            .map((friend) => normalizeFriend(friend, avatarScope))
      const groups = toArrayResult(groupsResult, 'groups').map((group) => normalizeGroup(group, avatarScope))
      // SnowLuma 的 get_recent_contact 只是占位，总是返回空列表。
      const recent = protocol === 'snowluma' ? [] : await loadRecentContacts(bot, friends, groups, imageUrlResolver)
      return {
        friends,
        groups,
        ...(friendCategories.length ? { friendCategories } : {}),
        ...(recent.length ? { recent } : {}),
      }
    },

    async loadMessages(query: WebQQMessageQuery): Promise<WebQQMessage[]> {
      const bot = getBot()
      const action = query.type === 'group' ? 'get_group_msg_history' : 'get_friend_msg_history'
      const count = query.limit ?? 30
      // SnowLuma 的历史以 message_id 为锚点（结果含锚点本身），不认 message_seq；它的消息序号就用 message_id
      // 充当（normalizeSnowLumaCursor），游标原样传回。锚点会与上一页重复，多取一条凑满一页，合并时按 ID 去重。
      const baseParams = protocol === 'snowluma'
        ? {
            message_id: query.beforeSequence ? toOneBotId(query.beforeSequence) : 0,
            count: query.beforeSequence ? count + 1 : count,
            reverse_order: true,
          }
        : {
            message_seq: query.beforeSequence ? toOneBotId(query.beforeSequence) : 0,
            count,
            ...(protocol === 'llbot' ? { reverseOrder: false } : {}),
          }
      const params = query.type === 'group'
        ? { group_id: toOneBotId(query.peerId), ...baseParams }
        : { user_id: toOneBotId(query.peerId), ...baseParams }
      const result = await callAction(bot, action, params)
      const messages = await Promise.all(toArrayResult(result, 'messages').map((message) => normalizeMessage(message, bot, imageUrlResolver)))
      return messages.map(normalizeSnowLumaCursor)
    },

    async sendMessage(payload: WebQQSendPayload) {
      const message = payload.elements.map(toOneBotSendSegment).filter((segment): segment is NonNullable<ReturnType<typeof toOneBotSendSegment>> => !!segment)
      // 回复段优先，保证 OneBot 实现按 message 数组首位 reply 解析引用目标。
      if (payload.replyToMessageId) {
        message.unshift({ type: 'reply', data: { id: payload.replyToMessageId } })
      }
      if (!message.length) return
      const bot = getBot()
      if (payload.type === 'group') {
        return readSentMessageId(await callAction(bot, 'send_group_msg', { group_id: toOneBotId(payload.peerId), message }))
      }
      return readSentMessageId(await callAction(bot, 'send_private_msg', { user_id: toOneBotId(payload.peerId), message }))
    },

    async recallMessage(input: WebQQMessageRecallInput) {
      if (!input.messageId) throw new Error('messageId 不能为空')
      await callAction(getBot(), 'delete_msg', { message_id: toOneBotId(input.messageId) })
    },

    async setMessageReaction(input: WebQQMessageReactionInput) {
      if (!input.messageId) throw new Error('messageId 不能为空')
      if (!input.emojiId) throw new Error('emojiId 不能为空')
      // SnowLuma 的表情回应只支持群消息，私聊直接拒绝而不是让它报一句英文错误。
      if (protocol === 'snowluma' && input.type === 'friend') throw new Error('SnowLuma 不支持私聊消息表情回应')
      const bot = getBot()
      // set_msg_emoji_like 按全局 message_id 定位消息；NapCat 与 LLBot 不区分私聊或群聊，不要在 WebQQ 层额外拦截私聊。
      const params: Record<string, unknown> = {
        message_id: toOneBotId(input.messageId),
        emoji_id: input.emojiId,
      }
      // NapCat 需要 set 标记；LLBot 通常忽略未知字段，因此统一带上。
      params.set = input.enabled
      await callAction(bot, 'set_msg_emoji_like', params)
    },

    async loadProfile(query: WebQQProfileQuery): Promise<WebQQProfile> {
      if (!query.userId) throw new Error('userId 不能为空')
      const bot = getBot()
      const fields: WebQQProfileField[] = []
      let stranger: Record<string, unknown> = {}
      try {
        stranger = getActionData(await callAction(bot, 'get_stranger_info', {
          user_id: toOneBotId(query.userId),
        }))
      } catch (error) {
        // 资料卡允许部分字段缺失，但 stranger 是基础读路径；仅当实现不支持时给出明确错误。
        if (!supportsOneBotAction(bot, 'get_stranger_info') && typeof bot.internal._request !== 'function') {
          throw new Error('当前 OneBot 实现不支持 get_stranger_info')
        }
        throw error
      }

      const nickname = getStringField(stranger, ['nickname', 'nick', 'name']) || query.userId
      const remark = getStringField(stranger, ['remark'])
      const personalNote = getStringField(stranger, ['personal_note', 'personalNote', 'long_nick', 'longNick', 'signature'])
      const rawSex = normalizeSexValue(getStringField(stranger, ['sex', 'gender']))
      const sex = normalizeSexLabel(rawSex)
      const ageValue = Number(stranger.age)
      const age = Number.isFinite(ageValue) && ageValue > 0 ? ageValue : undefined
      const qid = getStringField(stranger, ['qid', 'QID'])
      const level = getStringField(stranger, ['level', 'qqLevel', 'qq_level'])
      pushProfileField(fields, '基础', '昵称', nickname)
      pushProfileField(fields, '基础', '备注', remark)
      pushProfileField(fields, '基础', 'QQ', query.userId)
      pushProfileField(fields, '基础', '性别', sex)
      if (age != null) pushProfileField(fields, '基础', '年龄', String(age))
      pushProfileField(fields, '基础', 'QID', qid)
      pushProfileField(fields, '基础', '等级', level)
      pushProfileField(fields, '基础', '签名', personalNote)

      let groupCard = ''
      let groupTitle = ''
      let groupRole = ''
      let rawRole: WebQQProfile['rawRole']
      if (query.groupId) {
        try {
          const member = normalizeGroupMember(getActionData(await callAction(bot, 'get_group_member_info', {
            group_id: toOneBotId(query.groupId),
            user_id: toOneBotId(query.userId),
          })), readOneBotAvatarScope(bot))
          groupCard = member.card
          groupTitle = member.title || ''
          groupRole = member.role || ''
          rawRole = member.rawRole
          pushProfileField(fields, '群资料', '群名片', member.card)
          pushProfileField(fields, '群资料', '专属头衔', member.title)
          pushProfileField(fields, '群资料', '身份', member.role)
        } catch {
          // 群成员信息是增强字段，失败时仍返回 stranger 基础资料。
        }
      }

      // 未显式 select 时 getBot() 仍会落到唯一/默认 bot；资料卡“自己”判断要对齐真实 operator。
      const operatorId = getRealSelfId() || bot.selfId
      const isSelf = !!operatorId && String(query.userId) === String(operatorId)
      const canEditAvatar = isSelf && (
        supportsOneBotAction(bot, 'set_qq_avatar')
        || typeof bot.internal._request === 'function'
        || typeof bot.internal.set_qq_avatar === 'function'
      )
      const canEditSelf = isSelf && (
        supportsOneBotAction(bot, 'set_qq_profile')
        || typeof bot.internal._request === 'function'
        || typeof bot.internal.set_qq_profile === 'function'
      )

      return {
        kind: isSelf ? 'bot' : 'user',
        id: query.userId,
        name: nickname,
        avatar: resolveWebQQUserAvatar(getStringField(stranger, oneBotAvatarFields), query.userId, readOneBotAvatarScope(bot)),
        ...(nickname ? { nickname } : {}),
        ...(remark ? { remark } : {}),
        ...(personalNote ? { personalNote } : {}),
        ...(rawSex ? { sex: rawSex } : {}),
        ...(age != null ? { age } : {}),
        ...(qid ? { qid } : {}),
        ...(level ? { level } : {}),
        ...(query.groupId ? { groupId: query.groupId } : {}),
        ...(groupCard ? { groupCard } : {}),
        ...(groupTitle ? { groupTitle } : {}),
        ...(groupRole ? { groupRole } : {}),
        ...(rawRole ? { rawRole } : {}),
        fields,
        ...(canEditSelf ? { canEditSelf: true } : {}),
        ...(canEditAvatar ? { canEditAvatar: true } : {}),
      }
    },

    async updateSelfProfile(input: WebQQSelfProfileUpdate) {
      const bot = getBot()
      const avatar = input.avatar?.trim()
      if (avatar) {
        if (!supportsOneBotAction(bot, 'set_qq_avatar') && typeof bot.internal.set_qq_avatar !== 'function' && typeof bot.internal._request !== 'function') {
          throw new Error('当前 OneBot 实现不支持 set_qq_avatar')
        }
        await callAction(bot, 'set_qq_avatar', { file: avatar })
      }
      const nickname = input.nickname?.trim()
      const personalNote = input.personalNote
      const sex = input.sex
      if (!nickname && personalNote == null && sex == null) {
        if (avatar) return
        throw new Error('至少提供 nickname、personalNote、sex 或 avatar 之一')
      }
      if (!supportsOneBotAction(bot, 'set_qq_profile') && typeof bot.internal.set_qq_profile !== 'function' && typeof bot.internal._request !== 'function') {
        throw new Error('当前 OneBot 实现不支持 set_qq_profile')
      }
      // 其他用户全局资料只读；自身资料仅在协议支持时开放写回。
      const params: Record<string, unknown> = {}
      if (nickname) params.nickname = nickname
      if (personalNote != null) params.personal_note = personalNote
      // SnowLuma 的 sex 只收 0–2 的整数；其他实现沿用资料卡给出的取值。
      if (sex != null) params.sex = protocol === 'snowluma' ? toSnowLumaSex(sex) : sex
      await callAction(bot, 'set_qq_profile', params)
    },

    async performFriendAction(input: WebQQFriendAction) {
      if (!input.targetId) throw new Error('targetId 不能为空')
      const bot = getBot()
      if (input.action === 'delete') {
        await callSupportedAction(bot, ['delete_friend'], {
          user_id: toOneBotId(input.targetId),
        })
        return
      }
      if (input.action === 'set-remark') {
        await callSupportedAction(bot, ['set_friend_remark'], {
          user_id: toOneBotId(input.targetId),
          remark: input.remark ?? '',
        })
        return
      }
      if (input.action === 'poke') {
        // 私聊戳自己会被 OneBot 回成 user_id=selfId 的 notify，WebQQ 再按普通私聊解析就会开出自己和自己的会话。
        if (input.targetId === bot.selfId) throw new Error('不能戳自己')
        await callSupportedAction(bot, ['send_poke', 'friend_poke'], {
          user_id: toOneBotId(input.targetId),
        })
        return
      }
      throw new Error(`不支持的好友动作：${(input as WebQQFriendAction).action}`)
    },

    async performGroupAction(input: WebQQGroupAction) {
      if (!input.groupId) throw new Error('groupId 不能为空')
      const bot = getBot()
      if (input.action === 'kick') {
        if (!input.targetId) throw new Error('targetId 不能为空')
        await callAction(bot, 'set_group_kick', {
          group_id: toOneBotId(input.groupId),
          user_id: toOneBotId(input.targetId),
        })
        return
      }
      if (input.action === 'set-admin') {
        if (!input.targetId) throw new Error('targetId 不能为空')
        await callAction(bot, 'set_group_admin', {
          group_id: toOneBotId(input.groupId),
          user_id: toOneBotId(input.targetId),
          enable: input.enabled,
        })
        return
      }
      if (input.action === 'set-card') {
        if (!input.targetId) throw new Error('targetId 不能为空')
        await callAction(bot, 'set_group_card', {
          group_id: toOneBotId(input.groupId),
          user_id: toOneBotId(input.targetId),
          card: input.card ?? '',
        })
        return
      }
      if (input.action === 'set-title') {
        if (!input.targetId) throw new Error('targetId 不能为空')
        await callAction(bot, 'set_group_special_title', {
          group_id: toOneBotId(input.groupId),
          user_id: toOneBotId(input.targetId),
          special_title: input.title ?? '',
        })
        return
      }
      if (input.action === 'set-name') {
        await callAction(bot, 'set_group_name', {
          group_id: toOneBotId(input.groupId),
          group_name: input.name ?? '',
        })
        return
      }
      if (input.action === 'leave') {
        await callAction(bot, 'set_group_leave', {
          group_id: toOneBotId(input.groupId),
        })
        return
      }
      if (input.action === 'poke') {
        if (!input.targetId) throw new Error('targetId 不能为空')
        await callSupportedAction(bot, ['send_poke', 'group_poke'], {
          group_id: toOneBotId(input.groupId),
          user_id: toOneBotId(input.targetId),
        })
        return
      }
      throw new Error(`不支持的群动作：${(input as WebQQGroupAction).action}`)
    },

    async sendForward(input: WebQQForwardSendInput) {
      // SnowLuma 的专用转发接口部分失败后再走通用接口可能发出两份，只用专用接口。
      const forwardActions = (action: string) => protocol === 'snowluma' ? [action] : [action, 'send_forward_msg']
      if (!input.peerId) throw new Error('peerId 不能为空')
      if (!input.messageIds?.length) throw new Error('messageIds 不能为空')
      const bot = getBot()
      const messages = input.messageIds.map((messageId) => ({
        type: 'node',
        data: { id: messageId },
      }))
      if (input.type === 'group') {
        // 优先实现专用转发接口，失败再回退通用 send_forward_msg。
        return readSentMessageId(await callSupportedAction(
          bot,
          forwardActions('send_group_forward_msg'),
          {
            group_id: toOneBotId(input.peerId),
            messages,
          },
        ))
      }
      return readSentMessageId(await callSupportedAction(
        bot,
        forwardActions('send_private_forward_msg'),
        {
          user_id: toOneBotId(input.peerId),
          messages,
        },
      ))
    },

    async loadGroupInfo(query: WebQQGroupInfoQuery): Promise<WebQQGroupInfo> {
      const bot = getBot()
      const membersResult = await callAction(bot, 'get_group_member_list', { group_id: toOneBotId(query.groupId) })
      const announcements = await loadGroupAnnouncements(bot, query.groupId)
      const avatarScope = readOneBotAvatarScope(bot)
      return {
        announcements,
        members: toArrayResult(membersResult, 'members').map((member) => normalizeGroupMember(member, avatarScope)),
      }
    },

    async loadNotices(friendRequests: WebQQNotice[] = []): Promise<WebQQNotice[]> {
      const bot = getBot()
      try {
        const result = await callAction(bot, 'get_group_system_msg', {})
        return [...friendRequests, ...normalizeGroupNotices(result, readOneBotAvatarScope(bot))]
      } catch {
        return friendRequests
      }
    },

    async handleNotice(action: WebQQNoticeAction) {
      if (action.type === 'friend-request') {
        await callAction(getBot(), 'set_friend_add_request', {
          flag: action.flag,
          approve: action.approve,
        })
        return
      }
      await callAction(getBot(), 'set_group_add_request', {
        flag: action.flag,
        sub_type: action.subType || 'add',
        approve: action.approve,
      })
    },
  }
}
