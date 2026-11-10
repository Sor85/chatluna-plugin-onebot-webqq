import { tr } from '../../i18n'

export type GroupMemberRole = 'owner' | 'admin' | 'member'

export interface GroupMemberMenuTarget {
  userId: string
  role?: GroupMemberRole | string
}

// 协议不支持 transfer-owner；不暴露该入口。
export type GroupMemberMenuAction =
  | 'mention'
  | 'poke'
  | 'set-card'
  | 'set-title'
  | 'kick'
  | 'set-admin'
  | 'unset-admin'

export type GroupMemberInteractionAction = Extract<GroupMemberMenuAction, 'mention' | 'poke'>
export type GroupMemberManagementAction = Exclude<GroupMemberMenuAction, GroupMemberInteractionAction>

function normalizeRole(role?: string): GroupMemberRole {
  if (role === 'owner' || role === '群主') return 'owner'
  if (role === 'admin' || role === '管理员') return 'admin'
  return 'member'
}

export function getGroupMemberMenuActions(
  actor: GroupMemberMenuTarget | undefined,
  target: GroupMemberMenuTarget,
): GroupMemberMenuAction[] {
  if (!actor) return []
  const actorRole = normalizeRole(actor.role)
  const targetRole = normalizeRole(target.role)
  const actions: GroupMemberMenuAction[] = []
  if (actor.userId !== target.userId) actions.push('mention', 'poke')
  if (actor.userId === target.userId
    || actorRole === 'owner'
    || (actorRole === 'admin' && targetRole === 'member')) actions.push('set-card')
  // 与真实 QQ 一致：专属头衔只有群主可以授予，且可以授予给自己。
  if (actorRole === 'owner') actions.push('set-title')
  if (actorRole === 'owner' && targetRole !== 'owner') {
    actions.push(targetRole === 'admin' ? 'unset-admin' : 'set-admin')
  }
  if (actor.userId !== target.userId
    && targetRole !== 'owner'
    && (actorRole === 'owner' || (actorRole === 'admin' && targetRole === 'member'))) actions.push('kick')
  return actions
}

export function getGroupMemberInteractionActions(
  actor: GroupMemberMenuTarget | undefined,
  target: GroupMemberMenuTarget,
): GroupMemberInteractionAction[] {
  return getGroupMemberMenuActions(actor, target).filter(
    (action): action is GroupMemberInteractionAction => action === 'mention' || action === 'poke',
  )
}

export function getGroupMemberManagementActions(
  actor: GroupMemberMenuTarget | undefined,
  target: GroupMemberMenuTarget,
): GroupMemberManagementAction[] {
  return getGroupMemberMenuActions(actor, target).filter(
    (action): action is GroupMemberManagementAction => action !== 'mention' && action !== 'poke',
  )
}

export function getGroupMemberKickDisabledReason(
  actor: GroupMemberMenuTarget | undefined,
  target: GroupMemberMenuTarget,
): string {
  if (!actor || actor.userId === target.userId) return ''
  const actorRole = normalizeRole(actor.role)
  const targetRole = normalizeRole(target.role)
  if (actorRole === 'member') return tr('webqq.member.kickNeedsAdmin')
  if (actorRole === 'admin' && targetRole !== 'member') return tr('webqq.member.kickAdminLimit')
  return ''
}

export function hasGroupMemberManagementMenu(
  actor: GroupMemberMenuTarget | undefined,
  target: GroupMemberMenuTarget,
): boolean {
  // 禁用原因也是有效的权限反馈，不能因互动项上提而让管理入口无声消失。
  return getGroupMemberManagementActions(actor, target).length > 0
    || !!getGroupMemberKickDisabledReason(actor, target)
}
