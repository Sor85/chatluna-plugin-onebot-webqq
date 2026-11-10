import { IconAt, IconAward, IconHandClick, IconTag, IconUserMinus, IconUserPlus } from '@tabler/icons-react'
import { useT } from '../../i18n'
import type { WebQQChatStyle } from '../../../src/config/spec'
import type { WebQQMessageReaction, WebQQMessageReactionUser } from '../types'
import { getWebQQEmojiFace } from '../utils/emoji-catalog'
import {
  getGroupMemberKickDisabledReason,
  getGroupMemberMenuActions,
  type GroupMemberMenuTarget,
} from '../utils/group-menu'
import { WebQQContextMenuContent, WebQQContextMenuItem, WebQQContextMenuSubContent } from '../ui'

export interface GroupMemberMenuHandlers {
  onMention?: () => void
  onPoke?: () => void
  onSetCard: () => void
  onSetTitle: () => void
  onSetAdmin: (enabled: boolean) => void
  onKick: () => void
}

/** 群成员菜单：独立菜单时含 @ 与戳一戳；作为「群成员操作」子菜单时只放管理项。 */
export function WebQQGroupMemberMenu(props: { actor?: GroupMemberMenuTarget, member: GroupMemberMenuTarget, sub?: boolean } & GroupMemberMenuHandlers) {
  const t = useT()
  const actions = getGroupMemberMenuActions(props.actor, props.member)
  const kickDisabledReason = getGroupMemberKickDisabledReason(props.actor, props.member)
  const Content = props.sub ? WebQQContextMenuSubContent : WebQQContextMenuContent
  const icon = (Icon: typeof IconAt) => <Icon size={16} aria-hidden="true" />
  return (
    <Content>
      {!props.sub && actions.includes('mention') ? <WebQQContextMenuItem onClick={props.onMention}>{icon(IconAt)} {t('webqq.member.mention')}</WebQQContextMenuItem> : null}
      {!props.sub && actions.includes('poke') ? <WebQQContextMenuItem onClick={props.onPoke}>{icon(IconHandClick)} {t('webqq.member.poke')}</WebQQContextMenuItem> : null}
      {actions.includes('set-card') ? <WebQQContextMenuItem onClick={props.onSetCard}>{icon(IconTag)} {t('webqq.member.setCard')}</WebQQContextMenuItem> : null}
      {actions.includes('set-title') ? <WebQQContextMenuItem onClick={props.onSetTitle}>{icon(IconAward)} {t('webqq.member.setTitle')}</WebQQContextMenuItem> : null}
      {actions.includes('set-admin') ? <WebQQContextMenuItem onClick={() => props.onSetAdmin(true)}>{icon(IconUserPlus)} {t('webqq.member.setAdmin')}</WebQQContextMenuItem> : null}
      {actions.includes('unset-admin') ? <WebQQContextMenuItem onClick={() => props.onSetAdmin(false)}>{icon(IconUserMinus)} {t('webqq.member.unsetAdmin')}</WebQQContextMenuItem> : null}
      {actions.includes('kick')
        ? <WebQQContextMenuItem className="is-danger" onClick={props.onKick}>{icon(IconUserMinus)} {t('webqq.member.kick')}</WebQQContextMenuItem>
        : kickDisabledReason
          ? <WebQQContextMenuItem disabled>{icon(IconUserMinus)} {kickDisabledReason}</WebQQContextMenuItem>
          : null}
    </Content>
  )
}

const MAX_VISIBLE_REACTION_AVATARS = 3

function getReactionUsers(reaction: WebQQMessageReaction): WebQQMessageReactionUser[] {
  if (reaction.users?.length) return reaction.users
  return reaction.userId ? [{ userId: reaction.userId, userAvatar: reaction.userAvatar || '' }] : []
}

// 旧缓存和部分 OneBot 通知只保留 userId；这里按 QQ 头像地址补全，避免破图的 alt 文本被裁成数字头像。
function getReactionUserAvatar(user: WebQQMessageReactionUser) {
  return user.userAvatar || `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(user.userId)}&s=640`
}

/** 消息下方的表情回应。TIM 样式下叠放最多三个回应者头像，避免多人回应把气泡撑宽。 */
export function WebQQMessageReactions(props: {
  reactions: WebQQMessageReaction[]
  chatStyle: WebQQChatStyle
  readonly: boolean
  onToggle: (emojiId: string) => void
}) {
  return (
    <div className="onebot-webqq-webqq__message-reactions">
      {props.reactions.map((reaction) => {
        const face = getWebQQEmojiFace(reaction.emojiId)
        const users = getReactionUsers(reaction)
        const visibleUsers = users.slice(0, MAX_VISIBLE_REACTION_AVATARS)
        const content = (
          <>
            {face?.url
              ? <img className="onebot-webqq-webqq__message-reaction-emoji" src={face.url} alt={face.label} />
              : face?.label ?? reaction.label ?? reaction.emojiId}
            {props.chatStyle === 'tim' && users.length ? (
              <span className="onebot-webqq-webqq__message-reaction-users">
                {visibleUsers.map((user, index) => (
                  <span
                    key={user.userId}
                    className="onebot-webqq-webqq__message-reaction-avatar"
                    title={user.userName || user.userId}
                    style={{ zIndex: visibleUsers.length - index }}
                  >
                    <img className="onebot-webqq-webqq__message-reaction-avatar-image" src={getReactionUserAvatar(user)} alt={user.userName || user.userId} />
                  </span>
                ))}
              </span>
            ) : null}
          </>
        )
        return props.readonly
          ? <span key={reaction.emojiId} className="onebot-webqq-webqq__message-reaction">{content}</span>
          : (
              <button
                key={reaction.emojiId}
                className="onebot-webqq-webqq__message-reaction is-interactive"
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  props.onToggle(reaction.emojiId)
                }}
              >
                {content}
              </button>
            )
      })}
    </div>
  )
}
