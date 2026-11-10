import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { Config } from '../src/config/schema'
import { callAction, callSupportedAction, type OneBotBot } from '../src/onebot/actions'
import { toOneBotId } from '../src/onebot/data'
import { transcribeOneBotRecord } from '../src/onebot/media/records'
import { assertSafeOneBotMediaFile } from '../src/onebot/media/images'
import { createOneBotWebQQService } from '../src/webqq/adapters/onebot/service'
import { normalizeGroupNotices } from '../src/webqq/adapters/onebot/notices'
import { readWebQQPeer } from '../src/webqq/message-flow/session'
import { readStepThought } from '../src/chatluna/turns'

function createBot(request: (action: string, params: Record<string, unknown>) => Promise<unknown>): OneBotBot {
  return { platform: 'onebot', selfId: '9000', status: 1, internal: { _request: request } }
}

function rawMessage(id: number, sequence: number) {
  return { message_id: id, message_seq: sequence, time: 1700000000, sender: { user_id: 8000, nickname: '测试用户' }, message: [{ type: 'text', data: { text: '测试消息' } }] }
}

describe('OneBot 实现与响应', () => {
  it.each(['napcat', 'llbot', 'snowluma'])('配置接受 %s', (onebotProtocol) => {
    expect(Config({ onebotProtocol }).onebotProtocol).toBe(onebotProtocol)
  })

  it('拒绝错误信封而不是把失败显示为成功', async () => {
    const bot = createBot(async () => ({ status: 'failed', retcode: 1400, wording: '没有权限' }))
    await expect(callAction(bot, 'delete_msg')).rejects.toThrow('没有权限')
  })

  it('不支持的 action 可以回退到下一别名', async () => {
    const request = vi.fn(async (action: string) => action === 'first'
      ? { status: 'failed', retcode: 1404, wording: 'not supported' }
      : { status: 'ok', retcode: 0, data: { text: '成功' } })
    await expect(callSupportedAction(createBot(request), ['first', 'second'], {})).resolves.toMatchObject({ retcode: 0 })
    expect(request.mock.calls.map(([name]) => name)).toEqual(['first', 'second'])
  })

  it('SnowLuma 负数消息 ID 保留符号', () => {
    expect(toOneBotId('-12345')).toBe(-12345)
  })

  it('SnowLuma 历史按消息 ID 翻页，不把序号传成消息 ID', async () => {
    const request = vi.fn(async () => ({ status: 'ok', retcode: 0, data: { messages: [rawMessage(-321, 101)] } }))
    const service = createOneBotWebQQService({ bots: [createBot(request)] }, { protocol: 'snowluma' })
    const messages = await service.loadMessages({ type: 'friend', peerId: '8000', beforeSequence: '-456', limit: 30 })
    expect(request).toHaveBeenCalledWith('get_friend_msg_history', { user_id: 8000, message_id: -456, count: 31, reverse_order: true })
    expect(messages[0]).toMatchObject({ id: '-321', sequence: '-321' })
  })

  it('NapCat 继续按 message_seq 翻页', async () => {
    const request = vi.fn(async () => ({ status: 'ok', retcode: 0, data: { messages: [rawMessage(321, 101)] } }))
    const service = createOneBotWebQQService({ bots: [createBot(request)] }, { protocol: 'napcat' })
    const messages = await service.loadMessages({ type: 'group', peerId: '8000', beforeSequence: '120', limit: 30 })
    expect(request).toHaveBeenCalledWith('get_group_msg_history', { group_id: 8000, message_seq: 120, count: 30 })
    expect(messages[0]?.sequence).toBe('101')
  })

  it('SnowLuma 裸数组申请只显示一次并使用规范 flag', () => {
    const notices = normalizeGroupNotices({ data: [{ request_id: 12, flag: 'slreq:1:12:8000:1:0', group_id: 8000, invitor_uin: 9001, requester_uin: 8001 }] }, { synthesizeQQAvatars: false })
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ flag: 'slreq:1:12:8000:1:0', subType: 'invite' })
  })

  it('SnowLuma 语音失败不重试同处理器别名', async () => {
    const request = vi.fn(async () => ({ status: 'failed', retcode: 1400, wording: '语音不存在' }))
    await expect(transcribeOneBotRecord(createBot(request), '-123', 'snowluma')).rejects.toThrow('语音不存在')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['../private', '/etc/passwd', 'C:\\secret.txt', 'file:///tmp/secret'])('媒体标识拒绝路径 %s', (file) => {
    expect(() => assertSafeOneBotMediaFile(file)).toThrow()
  })
})

describe('角色内心活动', () => {
  it('只读文本与 reply 工具里的 think，不重复读取 toolCalls 或原生 reasoning', () => {
    const block = { type: 'tool-call', toolName: 'reply', input: { content: '<think>角色想法</think>回复' } }
    expect(readStepThought({ content: [{ type: 'reasoning', text: '原生推理' }, block], toolCalls: [block] })).toBe('角色想法')
  })
})

describe('ui-kit 毛玻璃', () => {
  it('使用宿主令牌并保留强制明暗两档', () => {
    const css = readFileSync(new URL('../client/styles/glass.css', import.meta.url), 'utf8')
    expect(css).toContain('--webqq-glass: var(--glass)')
    expect(css).toContain('--webqq-glass-page: var(--glass-page)')
    expect(css).toContain('--webqq-glass-blur: var(--glass-blur)')
    expect(css).toContain('html:not(.dark)')
    expect(css).toContain('html.dark')
    expect(css).toContain('@supports not (backdrop-filter: blur(1px))')
  })

  it('生产产物保留标准 backdrop-filter，不退化为仅 WebKit 前缀', () => {
    const css = readFileSync(new URL('../dist/client.css', import.meta.url), 'utf8')
    expect(css).toMatch(/(?<!-)backdrop-filter:\s*blur\(var\(--webqq-glass-blur\)\)/)
    // ui-kit 自身可能额外生成浏览器前缀；这里只守住 WebQQ 的标准声明。
  })
})

it('机器人私聊回显按 private: 对方账号归档，不归到机器人自身', () => {
  expect(readWebQQPeer({
    userId: '9000', channelId: 'private:8000',
    event: { id: 1, type: 'send', timestamp: 1, platform: 'onebot', selfId: '9000' },
  })).toEqual({ type: 'friend', peerId: '8000' })
})
