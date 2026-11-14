import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  asWarning,
  connectTo,
  destinationOf,
  hostFor,
  hostPicking,
  loadHostPicker,
  loadOnlinePane,
  loadRemotePane,
  loadTerminalMark,
  loadTerminalTab,
  madeOnline,
  mayEnd,
  openAll,
  openOnline,
  openRemote,
  openTerm,
  openTerminal,
  readSpec,
  remoteHosts,
  renameTerminal,
  said,
  scrollbackOf,
  sessions,
  usageOfTab,
  writeSpec,
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

  test('the api loads with no terminal open and every call is there', () => {
    for (const one of [
      connectTo,
      hostPicking,
      loadHostPicker,
      loadOnlinePane,
      loadRemotePane,
      loadTerminalMark,
      loadTerminalTab,
      madeOnline,
      mayEnd,
      openAll,
      openOnline,
      openRemote,
      openTerm,
      openTerminal,
      remoteHosts,
      renameTerminal,
      scrollbackOf,
      sessions,
      usageOfTab,
    ]) {
      expect(typeof one).toBe('function')
    }
  })
})

describe('a terminal file', () => {
  test('keeps its shell, folder, key and name through being written and read', () => {
    const spec = { shell: 'zsh', folder: '/home/me', key: 'k1', name: 'Build' }
    expect(readSpec(writeSpec(spec))).toMatchObject(spec)
    expect(readSpec('not json')).toBeNull()
  })

  test('an unknown warning setting falls back to warning about running shells', () => {
    expect(asWarning('nonsense')).toBe('running')
  })
})

describe('a remote destination', () => {
  test('is read from what was typed, with or without ssh, a user and a port', () => {
    const plain = destinationOf('ssh box')
    expect(plain).toMatchObject({ hostname: 'box', user: null, port: null })
    const full = destinationOf('me@box:2222')
    expect(full && said(full)).toBe('me@box:2222')
    expect(destinationOf('two words')).toBeNull()
    expect(destinationOf('  ')).toBeNull()
  })

  test('finds no host when none is known', () => {
    const wanted = destinationOf('box')
    expect(wanted && hostFor([], wanted)).toBeNull()
  })
})

describe('the overview preview', () => {
  test('a terminal with no session and no history shows nothing', async () => {
    expect(await scrollbackOf({ id: 'none', doc: '', home: null })).toBeNull()
  })
})
