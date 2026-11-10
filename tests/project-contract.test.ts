import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

it('分层说明全部登记且路径存在', () => {
  const guide = readFileSync(resolve(root, 'AGENTS.md'), 'utf8')
  const registered = [...guide.matchAll(/`([^`]+\/AGENTS\.md)`/g)].map((match) => match[1])
  expect(new Set(registered).size).toBe(registered.length)
  for (const path of registered) expect(existsSync(resolve(root, path)), path).toBe(true)
  const found: string[] = []
  const visit = (dir: string, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'lib', 'dist', 'data'].includes(entry.name)) continue
      const relative = prefix + entry.name
      if (entry.isDirectory()) visit(resolve(dir, entry.name), relative + '/')
      else if (entry.name === 'AGENTS.md' && prefix) found.push(relative)
    }
  }
  visit(root)
  expect(found.sort()).toEqual(registered.sort())
})

it('中英文语言键与插值参数一致', () => {
  const entries = (locale: string) => {
    const lines = readFileSync(resolve(root, `client/locales/${locale}.yml`), 'utf8').trim().split('\n')
    const result = new Map<string, string[]>()
    for (const line of lines) {
      const match = /^([\w.-]+): (.*)$/.exec(line)
      expect(match, line).not.toBeNull()
      if (!match) continue
      expect(result.has(match[1]), match[1]).toBe(false)
      result.set(match[1], [...match[2].matchAll(/\{(\w+)\}/g)].map((param) => param[1]).sort())
    }
    return [...result.entries()].sort(([a], [b]) => a.localeCompare(b))
  }
  expect(entries('en')).toEqual(entries('zh'))
})
