import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const LIB = fileURLToPath(new URL('../src/lib', import.meta.url))

const ROUTERS = new Set(['tauri.ts', 'native.ts', 'native-sync-store.ts'])

const ON_DISK_ON_PURPOSE = new Set(['quick-add/src/shortcuts.ts'])

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((one) => {
    const path = join(dir, one.name)
    if (one.isDirectory()) return one.name === 'internal' ? [] : sources(path)
    return /\.(ts|svelte)$/.test(one.name) && !/\.test\.ts$|\.fixture\.ts$/.test(one.name)
      ? [path]
      : []
  })
}

function fileCommands(): string[] {
  const roots = readFileSync(join(LIB, 'internal', 'roots.ts'), 'utf8')
  const listed = /const FILE_COMMANDS = new Set\(\[([^\]]*)\]\)/.exec(roots)?.[1] ?? ''
  return [...listed.matchAll(/'([a-z_]+)'/g)].map((one) => one[1] ?? '')
}

function nativeNames(text: string): string[] {
  const names: string[] = []
  for (const one of text.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*'(?:\.\.?\/)+native'|const\s*\{([^}]*)\}\s*=\s*await\s+import\('(?:\.\.?\/)+native'\)/g,
  )) {
    for (const part of (one[1] ?? one[2] ?? '').split(',')) {
      const [name, alias] = part.trim().split(/\s+as\s+|\s*:\s*/)
      if (name === 'invoke') names.push((alias ?? name).trim())
    }
  }
  for (const one of text.matchAll(/(\w+)\s*=\s*await\s+import\('(?:\.\.?\/)+native'\)/g))
    names.push(`${one[1] ?? ''}.invoke`)
  if (/import\('(?:\.\.?\/)+native'\)/.test(text) && /\bnative\.invoke\b/.test(text))
    names.push('native.invoke')
  return [...new Set(names)]
}

describe('a file in a space', () => {
  test('is read and written through the call that knows where Orden keeps it', () => {
    const commands = fileCommands()
    expect(commands).toContain('read_note')
    const wrong: string[] = []
    for (const path of sources(LIB)) {
      const at = relative(LIB, path).replace(/\\/g, '/')
      if (ROUTERS.has(at) || ON_DISK_ON_PURPOSE.has(at)) continue
      const text = readFileSync(path, 'utf8')
      for (const name of nativeNames(text)) {
        const called = new RegExp(`${name.replace('.', '\\.')}(?:<[^(]*>)?\\(\\s*'([a-z_]+)'`, 'g')
        for (const one of text.matchAll(called)) {
          if (commands.includes(one[1] ?? '')) wrong.push(`${at}: ${one[0]}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })
})
