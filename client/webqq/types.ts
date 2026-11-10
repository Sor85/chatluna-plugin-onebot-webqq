import type { WebQQGroupMember } from '../../src/webqq/types'

// 客户端的 WebQQ 类型门面：全部载荷类型只在 ../../src/webqq/types 声明一次，这里原样转发。
// 文件留在原地，是为了让几十个消费方的 import 路径一处不动。
//
// 不做别名导出。别名等于在类型层重造刚在事件名层消灭的「一个东西两个名字」——将来有人在客户端
// grep 服务端的类型名会一无所获，正是控制台契约要消除的那种困惑。
//
// ADR 0003：这条跨端 import 边只能指向零 koishi 依赖的 module，否则整个 koishi 会被静默打进浏览器
// 产物。由 tests/console-contract.test.ts 的 import 图守卫兜底。
export type * from '../../src/webqq/types'

// 客户端专属：群成员排序只有界面用得上，不属于载荷类型。
const webQQGroupRoleRanks: Record<string, number> = {
  群主: 0,
  管理员: 1,
}

function getWebQQGroupMemberDisplayName(member: WebQQGroupMember) {
  return member.card || member.nickname || member.userId
}

function getWebQQGroupMemberNameRank(member: WebQQGroupMember) {
  const first = getWebQQGroupMemberDisplayName(member).trim()[0] || ''
  if (/^[A-Za-z]$/.test(first)) return 0
  if (/^[0-9\u4e00-\u9fff]$/.test(first)) return 1
  return 2
}

// 按群角色优先级和展示名称排序群成员。
export function sortWebQQGroupMembers(members: WebQQGroupMember[]) {
  return members.slice().sort((left, right) => {
    const roleDiff = (webQQGroupRoleRanks[left.role || ''] ?? 2) - (webQQGroupRoleRanks[right.role || ''] ?? 2)
    if (roleDiff) return roleDiff
    const nameRankDiff = getWebQQGroupMemberNameRank(left) - getWebQQGroupMemberNameRank(right)
    if (nameRankDiff) return nameRankDiff
    const nameDiff = getWebQQGroupMemberDisplayName(left).localeCompare(getWebQQGroupMemberDisplayName(right), 'en', { sensitivity: 'base' })
    if (nameDiff) return nameDiff
    return left.userId.localeCompare(right.userId, 'en', { numeric: true, sensitivity: 'base' })
  })
}
