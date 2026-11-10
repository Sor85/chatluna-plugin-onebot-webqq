import type { Session } from '@satorijs/core'
import { getActionData, toOneBotId } from '../../../onebot/data'
import { isRecord, readRecordText } from '../../../shared/record'
import {
  hasWebQQSenderMetadata,
  readWebQQSenderMetadata,
  type WebQQSenderMetadata,
} from '../../sender/sender-metadata'

async function readWebQQGroupMemberInfo(session: Session, userId: string, noCache: boolean) {
  if ((session.bot.platform || session.platform) !== 'onebot') return
  const rawData = isRecord((session.event as { _data?: unknown })._data)
    ? (session.event as { _data?: Record<string, unknown> })._data
    : {}
  const groupId = session.channelId || session.guildId || session.event.channel?.id || session.event.guild?.id || readRecordText(rawData, ['group_id', 'groupId'])
  if (!groupId || !userId || !isRecord(session.bot)) return
  const internal = isRecord(session.bot.internal) ? session.bot.internal : undefined
  if (!internal) return
  const params = {
    group_id: toOneBotId(groupId),
    user_id: toOneBotId(userId),
    no_cache: noCache,
  }
  let result: unknown
  if (typeof internal.get_group_member_info === 'function') {
    result = await internal.get_group_member_info(params)
  } else if (typeof internal._request === 'function') {
    result = await internal._request('get_group_member_info', params)
  } else {
    return
  }
  const data = getActionData(result)
  return isRecord(data) ? data : undefined
}

export async function readWebQQGroupMemberName(session: Session, userId: string, noCache: boolean): Promise<string | undefined> {
  const data = await readWebQQGroupMemberInfo(session, userId, noCache)
  return readRecordText(data, ['card', 'nickname', 'name', 'user_name', 'userName']) || undefined
}

export async function readWebQQGroupSenderMetadata(session: Session, userId: string, noCache: boolean): Promise<WebQQSenderMetadata | undefined> {
  const data = await readWebQQGroupMemberInfo(session, userId, noCache)
  if (!data) return
  const metadata = readWebQQSenderMetadata(data)
  return hasWebQQSenderMetadata(metadata) ? metadata : undefined
}

export async function readWebQQBotGroupSenderMetadata(session: Session): Promise<WebQQSenderMetadata | undefined> {
  const userId = session.bot.selfId || session.selfId
  if (!userId) return
  return readWebQQGroupSenderMetadata(session, userId, false)
}
