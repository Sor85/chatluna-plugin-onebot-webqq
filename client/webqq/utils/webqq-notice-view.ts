import type { WebQQNotice } from '../types'
import { tr } from '../../i18n'

export function sortPendingNotices(items: WebQQNotice[]) {
  return items.slice().sort((left, right) => {
    if (left.status === right.status) return 0
    return left.status === 'pending' ? -1 : 1
  })
}

export function formatNoticeComment(comment: string) {
  const match = comment.match(/^(问题[:：].+?)(?:\s+|(?=答案[:：]))(答案[:：].+)$/)
  return match ? [match[1], match[2]] : [comment]
}

export function getHandledNoticeStatusText(notice: WebQQNotice) {
  if (notice.subType === 'leave') return ''
  if (notice.status === 'approved') return tr('webqq.notice.approved')
  if (notice.status === 'rejected') return tr('webqq.notice.rejected')
  return ''
}

/** 可处理的通知：控制台契约里 notice-action 的 flag 是必填，而通知本身的 flag 可能缺失。 */
export type HandleableWebQQNotice = WebQQNotice & { flag: string }

// 写成类型守卫而不是返回 boolean：`!!notice.flag` 只窄化 notice.flag，不窄化 notice 本身，于是
// 「只对带 flag 的通知发同意/拒绝」这条既有不变量到不了发送函数的类型上，最后只能靠把契约里的
// flag 放宽成可选才能编译——那等于让「不带 flag 的请求」变成合法载荷。
export function hasNoticeFlag(notice: WebQQNotice): notice is HandleableWebQQNotice {
  return !!notice.flag
}

export function canHandleNotice(notice: WebQQNotice): notice is HandleableWebQQNotice {
  return notice.subType !== 'leave' && notice.status === 'pending' && hasNoticeFlag(notice)
}
