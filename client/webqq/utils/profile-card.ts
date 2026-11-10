import type { WebQQFriend, WebQQGroup, WebQQGroupMember, WebQQProfile, WebQQProfileField } from '../types'
import { tr } from '../../i18n'

export type ProfileCardFieldGroup = 'account' | 'friendship' | 'group-member' | 'bot-runtime' | 'group'

export type ProfileCardEditableField = 'nickname' | 'personalNote' | 'sex'

export interface ProfileCardField {
  group: ProfileCardFieldGroup
  label: string
  value: string
  editKey?: ProfileCardEditableField
}

export interface ProfileCardModel {
  participantId: string
  name: string
  avatar?: string
  avatarKind: 'user' | 'bot' | 'group'
  identityLabel: 'QQ' | '群号'
  /** 个性签名单独展示在英雄区，不混入字段分组。 */
  personalNote?: string
  nickname?: string
  sex?: string
  canEditSelf?: boolean
  canEditAvatar?: boolean
  fields: ProfileCardField[]
}

export function getProfileCardGroupLabel(group: ProfileCardFieldGroup): string {
  return tr(`webqq.profile.group.${group}`)
}

function pushField(fields: ProfileCardField[], group: ProfileCardFieldGroup, label: string, value: string | number | boolean | undefined) {
  if (value === undefined || value === '') return
  fields.push({ group, label, value: String(value) })
}

function pushMissingField(fields: ProfileCardField[], group: ProfileCardFieldGroup, label: string, value: string | number | boolean | undefined) {
  if (fields.some((field) => field.group === group && field.label === label)) return
  pushField(fields, group, label, value)
}

function getEditableFieldKey(label: string): ProfileCardEditableField | undefined {
  if (label === '昵称') return 'nickname'
  if (label === '签名' || label === '个性签名') return 'personalNote'
  if (label === '性别') return 'sex'
}

function getSexLabel(value?: string): string {
  if (value === 'male') return '男'
  if (value === 'female') return '女'
  if (value === 'unknown') return '未知'
  return value || ''
}

function getGroupRole(member: WebQQGroupMember): string {
  if (member.role === 'owner' || member.role === '群主') return '群主'
  if (member.role === 'admin' || member.role === '管理员') return '管理员'
  return member.role || '成员'
}

// 真实能力模式：只展示已有字段，不伪造默认值。
export function buildUserProfileCardModel(input: {
  userId: string
  name: string
  avatar?: string
  avatarKind?: 'user' | 'bot'
  personalNote?: string
  isFriend?: boolean
  remark?: string
  friend?: WebQQFriend
  group?: WebQQGroup
  member?: WebQQGroupMember
  accountFields?: Array<{ label: string, value: string | number | boolean | undefined }>
}): ProfileCardModel {
  const fields: ProfileCardField[] = []
  pushField(fields, 'account', '昵称', input.name)
  pushField(fields, 'account', 'QQ', input.userId)
  for (const field of input.accountFields ?? []) {
    pushMissingField(fields, 'account', field.label, field.value)
  }
  if (input.isFriend) pushField(fields, 'friendship', '好友关系', '已是好友')
  pushField(fields, 'friendship', '好友备注', input.remark)
  if (input.friend?.categoryName) pushField(fields, 'friendship', '好友分组', input.friend.categoryName)

  if (input.group && input.member) {
    pushField(fields, 'group-member', '所在群', input.group.name)
    pushField(fields, 'group-member', '群号', input.group.groupId)
    pushField(fields, 'group-member', '群身份', getGroupRole(input.member))
    pushField(fields, 'group-member', '群名片', input.member.card)
    pushField(fields, 'group-member', '昵称', input.member.nickname)
  }

  return {
    participantId: input.userId,
    name: input.name,
    ...(input.avatar ? { avatar: input.avatar } : {}),
    avatarKind: input.avatarKind ?? 'user',
    identityLabel: 'QQ',
    ...(input.personalNote ? { personalNote: input.personalNote } : {}),
    fields,
  }
}

export function buildGroupProfileCardModel(group: WebQQGroup, memberCount?: number): ProfileCardModel {
  return {
    participantId: group.groupId,
    name: group.name,
    ...(group.avatar ? { avatar: group.avatar } : {}),
    avatarKind: 'group',
    identityLabel: '群号',
    fields: [
      { group: 'group', label: '群名称', value: group.name },
      { group: 'group', label: '群号', value: group.groupId },
      { group: 'group', label: '群成员', value: `${memberCount ?? group.memberCount} 人` },
    ],
  }
}

function normalizeProfileFieldGroup(group: string): ProfileCardFieldGroup {
  if (group === 'friendship' || group === 'group-member' || group === 'bot-runtime' || group === 'group' || group === 'account') {
    return group
  }
  return 'account'
}

export function buildProfileCardModelFromProfile(profile: WebQQProfile): ProfileCardModel {
  const canEditSelf = !!profile.canEditSelf
  const fields: ProfileCardField[] = profile.fields.map((field: WebQQProfileField) => {
    const group = normalizeProfileFieldGroup(field.group)
    const editKey = canEditSelf && group === 'account' ? getEditableFieldKey(field.label) : undefined
    return {
      group,
      label: field.label,
      value: editKey === 'sex' ? getSexLabel(profile.sex || field.value) : field.value,
      ...(editKey ? { editKey } : {}),
    }
  })
  if (canEditSelf) {
    const editableFields: Array<{ label: string, value: string, editKey: ProfileCardEditableField }> = [
      { label: '昵称', value: profile.nickname || profile.name, editKey: 'nickname' },
      { label: '性别', value: getSexLabel(profile.sex), editKey: 'sex' },
      { label: '签名', value: profile.personalNote || '', editKey: 'personalNote' },
    ]
    for (const editableField of editableFields) {
      const existing = fields.find((field) => field.group === 'account' && field.editKey === editableField.editKey)
      if (existing) continue
      // 可编辑字段即使尚未设置也必须出现在账号资料中，否则用户没有进入编辑状态的入口。
      fields.push({ group: 'account', ...editableField })
    }
  }
  return {
    participantId: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    avatarKind: profile.kind === 'bot' ? 'bot' : 'user',
    identityLabel: 'QQ',
    ...(profile.personalNote ? { personalNote: profile.personalNote } : {}),
    ...(profile.nickname ? { nickname: profile.nickname } : {}),
    ...(profile.sex ? { sex: profile.sex } : {}),
    canEditSelf,
    canEditAvatar: !!profile.canEditAvatar,
    fields,
  }
}

export function groupProfileCardFields(fields: readonly ProfileCardField[]): Array<{ group: ProfileCardFieldGroup, label: string, fields: ProfileCardField[] }> {
  const order: ProfileCardFieldGroup[] = ['account', 'friendship', 'group-member', 'bot-runtime', 'group']
  return order
    .map((group) => ({
      group,
      label: getProfileCardGroupLabel(group),
      fields: fields.filter((field) => field.group === group),
    }))
    .filter((section) => section.fields.length > 0)
}
