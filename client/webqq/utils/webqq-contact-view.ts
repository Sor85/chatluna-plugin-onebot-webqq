import { sortWebQQGroupMembers, type WebQQContacts, type WebQQConversationSummary, type WebQQFriend, type WebQQGroup, type WebQQGroupMember } from '../types'
import { tr } from '../../i18n'

export type WebQQChatSelection =
  | { type: 'friend'; peerId: string; name: string; subtitle: string; avatar: string }
  | { type: 'group'; peerId: string; name: string; subtitle: string; avatar: string }

export type WebQQRecentItem = WebQQChatSelection & { summary?: string; time?: number }
export type WebQQFriendCategoryView = { id: string; name: string; friends: WebQQFriend[] }

function getSearchQuery(value: string) {
  return value.trim().toLowerCase()
}

function matchesFriendSearch(friend: WebQQFriend, rawQuery: string, query: string) {
  return friend.name.toLowerCase().includes(query) ||
    friend.nickname.toLowerCase().includes(query) ||
    friend.userId.includes(rawQuery)
}

function matchesGroupSearch(group: WebQQGroup, rawQuery: string, query: string) {
  return group.name.toLowerCase().includes(query) || group.groupId.includes(rawQuery)
}

function matchesGroupMemberSearch(member: WebQQGroupMember, rawQuery: string, query: string) {
  return member.card.toLowerCase().includes(query) ||
    member.nickname.toLowerCase().includes(query) ||
    member.userId.includes(rawQuery)
}

export function getGroupSubtitle(group: WebQQGroup) {
  return tr('webqq.groupSubtitle', { groupId: group.groupId, count: group.memberCount })
}

export function getCurrentChatTitle(chat: WebQQChatSelection | undefined) {
  return chat?.name || 'WebQQ'
}

export function getCurrentChatSubtitle(chat: WebQQChatSelection | undefined, contacts: WebQQContacts) {
  if (!chat) return tr('webqq.chat.emptySubtitle')
  if (chat.type !== 'group') return chat.subtitle
  const group = contacts.groups.find((item) => item.groupId === chat.peerId)
  return group ? getGroupSubtitle(group) : chat.subtitle
}

export function getCurrentChatAvatar(chat: WebQQChatSelection | undefined) {
  return chat?.avatar || ''
}

export function createFriendChatSelection(friend: WebQQFriend): WebQQChatSelection {
  return {
    type: 'friend',
    peerId: friend.userId,
    name: friend.name,
    subtitle: friend.nickname,
    avatar: friend.avatar,
  }
}

export function createGroupChatSelection(group: WebQQGroup): WebQQChatSelection {
  return {
    type: 'group',
    peerId: group.groupId,
    name: group.name,
    subtitle: getGroupSubtitle(group),
    avatar: group.avatar,
  }
}

export function createRecentChatSelection(item: WebQQRecentItem): WebQQChatSelection {
  return {
    type: item.type,
    peerId: item.peerId,
    name: item.name,
    subtitle: item.subtitle,
    avatar: item.avatar,
  }
}

export function getChatKey(type: WebQQChatSelection['type'], peerId: string) {
  return `${type}:${peerId}`
}

export function findContactByKey(contacts: WebQQContacts, key: string): WebQQRecentItem | undefined {
  const [type, peerId] = key.split(':', 2)
  if (type === 'friend') {
    const friend = contacts.friends.find((item) => item.userId === peerId)
    if (!friend) return
    return {
      type: 'friend',
      peerId: friend.userId,
      name: friend.name,
      subtitle: friend.nickname,
      avatar: friend.avatar,
    }
  }
  if (type === 'group') {
    const group = contacts.groups.find((item) => item.groupId === peerId)
    if (!group) return
    return {
      type: 'group',
      peerId: group.groupId,
      name: group.name,
      subtitle: getGroupSubtitle(group),
      avatar: group.avatar,
    }
  }
}

export function hideRecentConversation(hiddenKeys: string[], type: WebQQChatSelection['type'], peerId: string) {
  const key = getChatKey(type, peerId)
  return hiddenKeys.includes(key) ? hiddenKeys : [...hiddenKeys, key]
}

export function revealRecentConversation(hiddenKeys: string[], type: WebQQChatSelection['type'], peerId: string) {
  const key = getChatKey(type, peerId)
  return hiddenKeys.includes(key) ? hiddenKeys.filter((item) => item !== key) : hiddenKeys
}

export function getRecentItems(
  contacts: WebQQContacts,
  conversationSummaries: Record<string, WebQQConversationSummary>,
  hiddenKeys: string[] = [],
) {
  const items = new Map<string, WebQQRecentItem>()
  const hidden = new Set(hiddenKeys)
  for (const item of contacts.recent ?? []) {
    items.set(getChatKey(item.type, item.peerId), item)
  }
  for (const [key, summary] of Object.entries(conversationSummaries)) {
    const item = findContactByKey(contacts, key)
    if (!item) continue
    items.set(key, {
      ...item,
      summary: summary.summary,
      time: summary.time,
    })
  }
  return [...items.values()]
    .filter((item) => !hidden.has(getChatKey(item.type, item.peerId)))
    .sort((left, right) => (right.time || 0) - (left.time || 0))
}

export function getContactSummary(conversationSummaries: Record<string, WebQQConversationSummary>, type: WebQQChatSelection['type'], peerId: string) {
  return conversationSummaries[getChatKey(type, peerId)]
}

export function getContactSubtitle(conversationSummaries: Record<string, WebQQConversationSummary>, type: WebQQChatSelection['type'], peerId: string, fallback: string) {
  return getContactSummary(conversationSummaries, type, peerId)?.summary || fallback
}

export function getContactTime(conversationSummaries: Record<string, WebQQConversationSummary>, type: WebQQChatSelection['type'], peerId: string, fallback = 0) {
  return getContactSummary(conversationSummaries, type, peerId)?.time || fallback
}

export function getUnreadCount(conversationUnreadCounts: Record<string, number>, type: WebQQChatSelection['type'], peerId: string) {
  return conversationUnreadCounts[getChatKey(type, peerId)] || 0
}

export function getVisibleFriends(contacts: WebQQContacts, rawQuery: string) {
  const query = getSearchQuery(rawQuery)
  if (!query) return contacts.friends
  return contacts.friends.filter((friend) => matchesFriendSearch(friend, rawQuery, query))
}

export function getVisibleGroups(contacts: WebQQContacts, rawQuery: string) {
  const query = getSearchQuery(rawQuery)
  if (!query) return contacts.groups
  return contacts.groups.filter((group) => matchesGroupSearch(group, rawQuery, query))
}

export function getVisibleFriendCategories(contacts: WebQQContacts, rawQuery: string) {
  const query = getSearchQuery(rawQuery)
  const categories = contacts.friendCategories?.length
    ? contacts.friendCategories
    : [{ id: 'all', name: tr('webqq.contacts.friendsCategory'), friends: contacts.friends }]
  return categories.map((category): WebQQFriendCategoryView => ({
    id: category.id,
    name: category.name,
    friends: category.friends.filter((friend) => !query || matchesFriendSearch(friend, rawQuery, query)),
  })).filter((category) => category.friends.length)
}

export function getVisibleGroupMembers(members: WebQQGroupMember[], rawQuery: string) {
  const query = getSearchQuery(rawQuery)
  const visibleMembers = query
    ? members.filter((member) => matchesGroupMemberSearch(member, rawQuery, query))
    : members
  return sortWebQQGroupMembers(visibleMembers)
}
