import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  appSessionIfAny,
  frameOf,
  hostApps,
  loadApplicationTab,
  makeApplication,
  openApplication,
} from '../src/api'
import { middle } from '../src/stats'
import { refreshRate } from '../src/view'
import { hostChoices, mayHost, programOf } from '../src/words'
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

  test('the api loads and every call is there', () => {
    for (const one of [
      appSessionIfAny,
      frameOf,
      hostApps,
      loadApplicationTab,
      makeApplication,
      openApplication,
    ]) {
      expect(typeof one).toBe('function')
    }
  })
})

describe('what an application is', () => {
  test('a program line is read the way a shell splits it', () => {
    expect(programOf('code --wait "My Notes/a b.md"')).toEqual({
      path: 'code',
      args: ['--wait', 'My Notes/a b.md'],
    })
    expect(programOf("say 'it\\s'")).toEqual({ path: 'say', args: ['it\\s'] })
    expect(programOf('open "unclosed')).toBeNull()
    expect(programOf('   ')).toBeNull()
  })

  test('only the three desktops host applications, and this computer is named as here', () => {
    expect(['linux', 'windows', 'macos'].every(mayHost)).toBe(true)
    expect(mayHost('ios')).toBe(false)
    const computers = [
      { id: 'a', name: 'Desk', platform: 'linux', current: true },
      { id: 'b', name: 'Laptop', platform: 'macos', current: false },
    ]
    expect(hostChoices(computers, (name) => `${name} (here)`)).toEqual([
      { id: 'a', label: 'Desk (here)', primary: true },
      { id: 'b', label: 'Laptop', primary: false },
    ])
  })
})

describe('the picture', () => {
  test('a screen refresh rate is read from the middle of the frame gaps once there are enough', () => {
    expect(refreshRate([16, 17, 16, 17, 16, 17, 16])).toBeNull()
    expect(refreshRate([16, 17, 16, 17, 16, 17, 16, 17, 40])).toBe(59)
    expect(refreshRate(Array.from({ length: 8 }, () => 1))).toBeNull()
    expect(middle([30, 10, 20])).toBe(20)
    expect(middle([])).toBeNull()
  })
})
