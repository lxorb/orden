import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, vi } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

function sources(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts')) out.push(path)
    }
  }
  walk(SOURCE)
  return out
}

test('a store hears another window write its key through heardElsewhere, not a listener of its own', () => {
  const own = sources()
    .map((path) => relative(SOURCE, path).replace(/\\/g, '/'))
    .filter((name) => name !== 'lib/platform/src/stored.ts')
    .filter((name) =>
      /addEventListener\(\s*'storage'/.test(readFileSync(join(SOURCE, name), 'utf8')),
    )

  expect(own).toEqual([])
})

test('hears its own keys and a storage cleared, and stops when asked', async () => {
  const listeners = new Set<(event: { key: string | null }) => void>()
  vi.stubGlobal('window', {
    addEventListener: (_type: string, one: (event: { key: string | null }) => void) =>
      listeners.add(one),
    removeEventListener: (_type: string, one: (event: { key: string | null }) => void) =>
      listeners.delete(one),
  })
  const { heardElsewhere } = await import('../src/lib/platform/src/stored')
  const heard: (string | null)[] = []
  const stop = heardElsewhere(['orden:a'], (key) => heard.push(key))
  const told = (key: string | null) => {
    for (const one of listeners) one({ key })
  }

  told('orden:a')
  told('orden:b')
  told(null)
  stop()
  told('orden:a')

  expect(heard).toEqual(['orden:a', null])
  vi.unstubAllGlobals()
})
