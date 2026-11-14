import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { providePort } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import { asChannel, ready, restartToUpdate } from '../src/api'

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

  test('the api leaves the update by the system and the move to Applications behind doors', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const statics = [...api.matchAll(/from '\.\/([A-Za-z.-]+)'/g)].map((found) => found[1])
    expect(statics).not.toContain('system-update')
    expect(statics).not.toContain('app-place')
  })
})

describe('an update', () => {
  test('comes from the stable channel unless the unstable one was asked for', () => {
    expect(asChannel('unstable')).toBe('unstable')
    expect(asChannel('nightly')).toBe('stable')
    expect(asChannel(undefined)).toBe('stable')
  })

  test('is not restarted into when quitting is refused', async () => {
    const asked: string[] = []
    const unbind = providePort('quit.ask', {
      mayStop: (why) => {
        asked.push(why)
        return Promise.resolve(false)
      },
    })
    await restartToUpdate()
    unbind()
    expect(asked).toEqual(['restart'])
    expect(ready()).toBe(false)
  })
})
