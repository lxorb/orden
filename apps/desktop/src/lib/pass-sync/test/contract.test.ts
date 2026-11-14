import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  hidesPasswords,
  isPassSecret,
  lockPass,
  mayEdit,
  mayHandOn,
  mayManage,
  openPass,
  pass,
  PIN_TRIES,
  quietPass,
  startPassSync,
} from '../src/api'
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

  test('the api loads with the vault locked and every call is there', () => {
    for (const one of [lockPass, openPass, quietPass, startPassSync]) {
      expect(typeof one).toBe('function')
    }
    expect(pass).toBeTruthy()
    expect(PIN_TRIES).toBeGreaterThan(0)
  })
})

describe('what a role may do', () => {
  test('a viewer reads, an editor edits, a manager manages, only the owner hands on', () => {
    expect(mayEdit({ role: 'viewer' })).toBe(false)
    expect(mayEdit({ role: 'editor' })).toBe(true)
    expect(mayManage({ role: 'editor' })).toBe(false)
    expect(mayManage({ role: 'manager' })).toBe(true)
    expect(mayHandOn({ role: 'manager' })).toBe(false)
    expect(mayHandOn({ role: 'owner' })).toBe(true)
  })

  test('passwords are hidden only from a viewer of a vault that asks for it', () => {
    expect(hidesPasswords({ role: 'viewer', hidePasswordsFromViewers: true })).toBe(true)
    expect(hidesPasswords({ role: 'viewer', hidePasswordsFromViewers: false })).toBe(false)
    expect(hidesPasswords({ role: 'owner', hidePasswordsFromViewers: true })).toBe(false)
  })
})

describe('the clipboard', () => {
  test('holds no Pass secret until one is copied', () => {
    expect(isPassSecret('')).toBe(false)
    expect(isPassSecret('anything typed')).toBe(false)
  })
})
