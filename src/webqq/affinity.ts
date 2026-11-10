import type { Context } from 'cordis'
import type { WebQQChatType, WebQQMessage } from './types'
import { isRecord } from '../shared/record'

/**
 * 好感度来自 ChatLuna v2 角色引擎：它把人物状态按「预设 + 平台用户」存放，`favor` 就是好感度。
 * 同一个人在不同预设下好感度不同，所以要先按机器人与会话解析出当前生效的预设，再取那份记录。
 * 引擎或 chat 服务没有加载时没有数据，界面不显示徽标。
 */
interface CharacterPeopleService {
  people(): Promise<readonly unknown[]>
}

interface ChatBindingService {
  binding(identity: Record<string, unknown>): unknown
}

export interface WebQQAffinityPeer {
  selfId: string
  type: WebQQChatType
  peerId: string
}

// people() 每次都遍历整张人物表；一次历史加载或一串实时消息共用短期结果。
const PEOPLE_CACHE_MS = 3000

function readPresetId(binding: unknown) {
  const preset = isRecord(binding) && isRecord(binding.preset) ? binding.preset.preset : undefined
  return typeof preset === 'string' && preset ? preset : undefined
}

export function createWebQQAffinityReader(ctx: Context, enabled: () => boolean) {
  let cached: { at: number, people: Promise<readonly unknown[]> } | undefined

  const readPeople = (character: CharacterPeopleService) => {
    if (!cached || Date.now() - cached.at > PEOPLE_CACHE_MS) {
      cached = { at: Date.now(), people: character.people() }
    }
    return cached.people
  }

  const resolvePreset = (peer: WebQQAffinityPeer) => {
    const chat = ctx.get('chat') as ChatBindingService | undefined
    if (typeof chat?.binding !== 'function') return
    const isDirect = peer.type === 'friend'
    return readPresetId(chat.binding({
      platform: 'onebot',
      selfId: peer.selfId,
      isDirect,
      ...(isDirect ? {} : { guildId: peer.peerId }),
      channelId: isDirect ? `private:${peer.peerId}` : peer.peerId,
      userId: isDirect ? peer.peerId : '',
    }))
  }

  return async function attachWebQQAffinityBadges(messages: WebQQMessage[], peer: WebQQAffinityPeer | undefined, logger?: Context['logger']) {
    if (!enabled() || !peer || !messages.length) return messages
    const character = ctx.get('character') as CharacterPeopleService | undefined
    if (typeof character?.people !== 'function') return messages
    try {
      const preset = resolvePreset(peer)
      if (!preset) return messages
      const favors = new Map<string, number>()
      for (const person of await readPeople(character)) {
        if (!isRecord(person) || person.preset !== preset || person.platform !== 'onebot') continue
        const favor = isRecord(person.fields) ? person.fields.favor : undefined
        if (typeof person.userId === 'string' && typeof favor === 'number' && Number.isFinite(favor)) favors.set(person.userId, favor)
      }
      if (!favors.size) return messages
      return messages.map((message) => {
        const favor = favors.get(message.senderId)
        return favor === undefined ? message : { ...message, senderAffinity: favor }
      })
    } catch (error) {
      logger?.debug('affinity load failed: %s', error instanceof Error ? error.message : String(error))
      return messages
    }
  }
}

export type WebQQAffinityReader = ReturnType<typeof createWebQQAffinityReader>
