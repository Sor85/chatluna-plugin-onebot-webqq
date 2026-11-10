export interface FriendMenuState {
  isFriend: boolean
  pendingOutgoing: boolean
  pendingIncoming: boolean
}

// 协议不支持主动 request；只开放已是好友的互动动作。
export type FriendMenuAction = 'poke' | 'remark' | 'delete'

export function getFriendMenuActions(state: FriendMenuState, includeInteraction: boolean): FriendMenuAction[] {
  if (!state.isFriend) return []
  return includeInteraction
    ? ['poke', 'remark', 'delete']
    : ['remark', 'delete']
}
