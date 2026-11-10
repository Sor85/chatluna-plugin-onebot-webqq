import { randomUUID } from 'node:crypto'
import * as dns from 'node:dns/promises'
import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { extname } from 'node:path'
import { readConfigDefault } from '../../config/spec'

export interface WebQQImageUrlResolverEntryOptions {
  refresh?: () => Promise<string>
}

export type WebQQImageUrlResolver = (file: string, options?: WebQQImageUrlResolverEntryOptions) => string

interface WebQQImageUrlResolverContext {
  /** 在 `${WEBQQ_IMAGE_ROUTE_PREFIX}/:id` 注册代理路由。 */
  serve(handle: (id: string) => Promise<Response>): void
  /** 把浏览器放不出来的语音（SILK、AMR）转成 WAV；失败时原样返回。 */
  transcodeVoice?(body: Buffer): Promise<Buffer>
}

interface WebQQImageUrlResolverLogger {
  info(format: string, ...param: unknown[]): unknown
}

export interface WebQQImageUrlResolverOptions {
  cacheEnabled?: boolean
  cacheLimitBytes?: number
  cacheItemLimitBytes?: number
}

interface CachedWebQQImage {
  body: Buffer
  contentType: string
  size: number
  lastAccessed: number
}

interface WebQQImageMapping {
  file: string
  refresh?: () => Promise<string>
}

export const WEBQQ_IMAGE_ROUTE_PREFIX = '/onebot-webqq/webqq/image' as const
const WEBQQ_IMAGE_CACHE_CONTROL = 'private, max-age=86400, immutable'
// 缓存上限的默认值来自配置规格；这里只负责把 MB 换算成字节。
const WEBQQ_IMAGE_CACHE_LIMIT = readConfigDefault('webQQImageCacheLimitMB') * 1024 * 1024
const WEBQQ_IMAGE_CACHE_ITEM_LIMIT = readConfigDefault('webQQImageCacheItemLimitMB') * 1024 * 1024
const WEBQQ_IMAGE_MAPPING_LIMIT = 1000
const WEBQQ_IMAGE_REDIRECT_LIMIT = 5
const WEBQQ_IMAGE_REFRESH_LIMIT = 3

const BROWSER_INCOMPATIBLE_AUDIO = new Set(['audio/amr', 'application/octet-stream'])
const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain'])

export function isRemoteImageSource(file: string) {
  return /^https?:\/\//.test(file)
}

// 浏览器自己就能渲染的取值。塞进图片代理只会绕一圈再取不回来：代理既不会 fetch data:，
// 也没法把它当路径 readFile，结果是 502 加一张碎图。
const renderableDataMediaPattern = /^data:(?:image|audio|video)\//i
const dataMediaPattern = /^data:/i
// 非 http(s) 的 scheme。代理会把它当本地路径 readFile，注定失败——例如提供方自己的
// 受管媒体引用（`sandbox-media://<hash>` 这类）只有它自己解得开。
const foreignMediaSchemePattern = /^[a-z][a-z0-9+.-]*:\/\//i

export function isDirectMediaSource(file: string) {
  return renderableDataMediaPattern.test(file.trim())
}

export function isUnresolvableMediaSource(file: string) {
  const value = file.trim()
  if (!value || isRemoteImageSource(value) || isDirectMediaSource(value)) return false
  return dataMediaPattern.test(value) || foreignMediaSchemePattern.test(value)
}

/**
 * 把消息段里的媒体取值换成前端真能取回的地址。
 *
 * 三类取值分开处理：浏览器能直接渲染的原样交给前端，代理和浏览器都取不回的返回空串
 * （由调用方渲染成占位，而不是让 `<img>` 变成碎图），其余照旧进代理。
 */
export function resolveWebQQMediaUrl(file: string, resolve?: (file: string) => string) {
  const value = file.trim()
  if (!value) return ''
  if (isDirectMediaSource(value)) return value
  if (isUnresolvableMediaSource(value)) return ''
  return resolve?.(value) || value
}

export function detectMediaContentType(buf: Buffer): string | undefined {
  if (buf[0] === 0x23 && buf[1] === 0x21 && buf[2] === 0x41 && buf[3] === 0x4d && buf[4] === 0x52) return 'audio/amr'
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'audio/mpeg'
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'audio/ogg'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'audio/wav'
  return undefined
}

export function getImageContentType(file: string) {
  switch (extname(file).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.svg':
      return 'image/svg+xml'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    case '.ogg':
    case '.opus':
      return 'audio/ogg'
    case '.amr':
      return 'audio/amr'
    case '.silk':
      return 'application/octet-stream'
    default:
      return 'image/png'
  }
}

function readIPv4Parts(hostname: string) {
  const parts = hostname.split('.').map((part) => Number(part))
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : undefined
}

function isPrivateIPv4(hostname: string) {
  const parts = readIPv4Parts(hostname)
  if (!parts) return false
  const [a, b] = parts
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
}

function isFakeIPRangeIPv4(hostname: string) {
  const parts = readIPv4Parts(hostname)
  if (!parts) return false
  const [a, b] = parts
  return a === 198 && (b === 18 || b === 19)
}

function isPrivateIPv6(hostname: string) {
  if (hostname === '::' || hostname === '::1') return true
  const mappedIPv4 = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mappedIPv4) return isPrivateIPv4(mappedIPv4[1])
  const first = Number.parseInt(hostname.split(':')[0] || '0', 16)
  if (!Number.isFinite(first)) return false
  return first === 0 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
}

function isPrivateOrLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  if (LOCAL_HOSTNAMES.has(normalized) || normalized.endsWith('.localhost')) return true
  const ipVersion = isIP(normalized)
  if (ipVersion === 4) return isPrivateIPv4(normalized)
  if (ipVersion === 6) return isPrivateIPv6(normalized)
  return false
}

async function canProxyRemoteImageSource(file: string) {
  try {
    const url = new URL(file)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (isPrivateOrLocalHostname(url.hostname)) return false
    const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true })
    return addresses.length > 0 && addresses.every((address) => {
      // Clash/TUN fake-ip DNS commonly maps public domains to 198.18/15.
      // The URL hostname was already checked to be a domain, so this branch keeps real QQ CDN
      // images working without allowing direct http://198.18.x.x/ private-target probes.
      if (isFakeIPRangeIPv4(address.address)) return true
      return !isPrivateOrLocalHostname(address.address)
    })
  } catch {
    return false
  }
}

async function fetchRemoteImage(file: string, redirectCount = 0): Promise<{ response: Response, file: string } | undefined> {
  if (redirectCount > WEBQQ_IMAGE_REDIRECT_LIMIT) return
  if (!await canProxyRemoteImageSource(file)) return
  const response = await fetch(file, { redirect: 'manual' })
  const location = response.status >= 300 && response.status < 400
    ? response.headers.get('location')
    : ''
  if (!location) return { response, file }
  const nextFile = new URL(location, file).toString()
  return fetchRemoteImage(nextFile, redirectCount + 1)
}

function readContentLength(response: Response) {
  const value = response.headers.get('content-length')
  if (!value) return undefined
  const length = Number(value)
  return Number.isFinite(length) && length >= 0 ? length : undefined
}

async function readRemoteImageBody(response: Response, limitBytes: number) {
  const contentLength = readContentLength(response)
  if (contentLength != null && contentLength > limitBytes) return undefined
  if (!response.body) {
    const body = Buffer.from(await response.arrayBuffer())
    return body.length <= limitBytes ? body : undefined
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    total += chunk.value.byteLength
    if (total > limitBytes) {
      await reader.cancel()
      return undefined
    }
    chunks.push(Buffer.from(chunk.value))
  }
  return Buffer.concat(chunks, total)
}

export function createWebQQImageUrlResolver(
  ctx: WebQQImageUrlResolverContext,
  logger?: WebQQImageUrlResolverLogger,
  options: WebQQImageUrlResolverOptions = {},
): WebQQImageUrlResolver {
  const files = new Map<string, WebQQImageMapping>()
  const ids = new Map<string, string>()
  const imageCache = new Map<string, CachedWebQQImage>()
  let imageCacheSize = 0
  const cacheEnabled = options.cacheEnabled ?? readConfigDefault('webQQImageCacheEnabled')
  const cacheLimitBytes = options.cacheLimitBytes ?? WEBQQ_IMAGE_CACHE_LIMIT
  const cacheItemLimitBytes = options.cacheItemLimitBytes ?? WEBQQ_IMAGE_CACHE_ITEM_LIMIT

  function respond(id: string, body: Buffer, contentType: string, status = 200) {
    return new Response(new Uint8Array(body), {
      status,
      headers: {
        'content-type': contentType,
        'cache-control': WEBQQ_IMAGE_CACHE_CONTROL,
        etag: `"${id}"`,
      },
    })
  }

  function evictCachedImage(id: string) {
    const cached = imageCache.get(id)
    if (cached) imageCacheSize -= cached.size
    imageCache.delete(id)
  }

  function trimImageMappings() {
    while (files.size > WEBQQ_IMAGE_MAPPING_LIMIT) {
      const oldestId = files.keys().next().value
      if (!oldestId) break
      const mapping = files.get(oldestId)
      files.delete(oldestId)
      if (mapping) ids.delete(mapping.file)
      evictCachedImage(oldestId)
    }
  }

  function rememberImageMapping(id: string, file: string, refresh?: () => Promise<string>) {
    const current = files.get(id)
    files.delete(id)
    if (current) ids.delete(current.file)
    ids.delete(file)
    if (current && current.file !== file) evictCachedImage(id)
    files.set(id, { file, refresh: refresh || current?.refresh })
    ids.set(file, id)
    trimImageMappings()
  }

  function cacheImage(id: string, body: Buffer, contentType: string) {
    if (!cacheEnabled || body.length > cacheItemLimitBytes) return

    evictCachedImage(id)

    imageCache.set(id, {
      body,
      contentType,
      size: body.length,
      lastAccessed: Date.now(),
    })
    imageCacheSize += body.length

    while (imageCacheSize > cacheLimitBytes) {
      let oldestId: string | undefined
      let oldestAccess = Infinity
      for (const [cacheId, cachedImage] of imageCache) {
        if (cachedImage.lastAccessed < oldestAccess) {
          oldestId = cacheId
          oldestAccess = cachedImage.lastAccessed
        }
      }
      if (!oldestId) break
      evictCachedImage(oldestId)
    }
  }

  async function transcodeIfNeeded(body: Buffer, contentType: string): Promise<{ body: Buffer, contentType: string }> {
    if (!ctx.transcodeVoice || !BROWSER_INCOMPATIBLE_AUDIO.has(contentType)) return { body, contentType }
    try {
      return { body: await ctx.transcodeVoice(body), contentType: 'audio/wav' }
    } catch {
      return { body, contentType }
    }
  }

  ctx.serve(async (id) => {
    let mapping = files.get(id)
    if (!mapping) return new Response(null, { status: 404 })
    if (cacheEnabled) {
      const cached = imageCache.get(id)
      if (cached) {
        cached.lastAccessed = Date.now()
        return respond(id, cached.body, cached.contentType)
      }
    }
    try {
      let refreshCount = 0
      while (true) {
        const { file } = mapping
        logger?.info('webqq image proxy %s', JSON.stringify({ id, file }))
        if (isRemoteImageSource(file)) {
          // 入站消息里的远程 URL 由聊天发送方控制；这里必须校验 DNS 最终 IP，
          // 并逐跳禁用自动重定向，避免域名重绑定或 302 跳转把控制台预览打到内网。
          const resolved = await fetchRemoteImage(file)
          if (!resolved) return new Response(null, { status: 403 })
          const { response, file: resolvedFile } = resolved
          if (response.status === 400 && mapping.refresh && refreshCount < WEBQQ_IMAGE_REFRESH_LIMIT) {
            refreshCount += 1
            const refreshed = await mapping.refresh()
            if (refreshed) {
              rememberImageMapping(id, refreshed, mapping.refresh)
              mapping = files.get(id) || mapping
              continue
            }
          }
          if (!response.ok) return new Response(null, { status: response.status })
          const rawBody = await readRemoteImageBody(response, cacheItemLimitBytes)
          if (!rawBody) return new Response(null, { status: 413 })
          const rawContentType = detectMediaContentType(rawBody) || response.headers.get('content-type') || getImageContentType(resolvedFile)
          const { body, contentType } = await transcodeIfNeeded(rawBody, rawContentType)
          cacheImage(id, body, contentType)
          return respond(id, body, contentType, response.status)
        }
        const rawBody = await readFile(file)
        const rawContentType = detectMediaContentType(rawBody) || getImageContentType(file)
        const { body, contentType } = await transcodeIfNeeded(rawBody, rawContentType)
        cacheImage(id, body, contentType)
        return respond(id, body, contentType)
      }
    } catch (error) {
      logger?.info('webqq image proxy failed %s', JSON.stringify({ id, file: mapping.file, error: error instanceof Error ? error.message : String(error) }))
      return new Response(null, { status: 502 })
    }
  })

  return (file, entryOptions = {}) => {
    const cached = ids.get(file)
    if (cached) {
      rememberImageMapping(cached, file, entryOptions.refresh)
      return `${WEBQQ_IMAGE_ROUTE_PREFIX}/${cached}`
    }
    const id = randomUUID()
    rememberImageMapping(id, file, entryOptions.refresh)
    return `${WEBQQ_IMAGE_ROUTE_PREFIX}/${id}`
  }
}
