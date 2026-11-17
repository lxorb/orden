import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { internalInvoke, keptMounts, webMeta } from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const ROOT = join(HERE, '../../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts']

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

function pendingOf(): string[] {
  const json = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as { pending?: string[] }
  return json.pending ?? []
}

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const pending = pendingOf()
    const reaching = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap(
        (found) => {
          const target = resolve(dirname(file), found[1] ?? '')
          if (target.startsWith(SRC)) return []
          if (/\/[a-z-]+\/src\/api$/.test(target)) return []
          const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
          const named = path === undefined ? target : relative(ROOT, path)
          return pending.includes(named) ? [] : [`${relative(SRC, file)}: ${found[1]}`]
        },
      ),
    )
    expect(reaching).toEqual([])
  })

  test('reaches only the modules it names', () => {
    const reached = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/from '(?:\.\.\/)+([a-z-]+)\/src\/api'/g)].map(
        (found) => found[1],
      ),
    )
    expect([...new Set(reached)].sort()).toEqual([
      'away',
      'crate',
      'handoff',
      'platform',
      'seeded',
      'snapshots',
      'ui-kit',
    ])
  })
})

describe('the backends for a browser and for spaces kept here', () => {
  test('the api names no backend file statically, so startup carries only its doors', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const statics = [...api.matchAll(/^(?:import|export) (?!type )[^;]*? from '([^']+)'/gm)].map(
      (found) => found[1],
    )
    expect(statics).toEqual([])
    expect(api).toMatch(/import\('\.\/web\/commands'\)/)
    expect(api).toMatch(/import\('\.\/internal\/route'\)/)
  })

  test('what the browser keeps beside the notes is read back, and gone once removed', async () => {
    const meta = await webMeta()
    await meta.put('contract:key', 'kept')
    expect(await meta.get('contract:key')).toBe('kept')
    await meta.remove('contract:key')
    expect(await meta.get('contract:key')).toBeUndefined()
  })

  test('with nothing mounted, a folder is no kept space and has no listing here', async () => {
    const mounts = await keptMounts()
    expect(await mounts.mountedFor('/spaces/Plans')).toBe(false)
    expect(await mounts.listedUnder('/spaces/Plans')).toBeNull()
    expect(mounts.hearInternal('/spaces/Plans', () => undefined)).toBeNull()
  })

  test('a question about a PDF twice on disk has no answer inside a kept space', async () => {
    expect(await internalInvoke('same_pdf', { space: '/spaces/Plans' })).toBeNull()
  })
})
