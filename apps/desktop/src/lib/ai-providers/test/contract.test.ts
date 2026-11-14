import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  checkKeysMoved,
  chatgptPlan,
  firstModel,
  isLocal,
  KIND_NAMES,
  loadKeysMoved,
  loadPlanRows,
  localCli,
  MODES,
  modeIn,
  modeOfGrant,
  noMoreThan,
  offeredKinds,
  sseJson,
  sseLines,
  talkable,
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

  test('the local programs, the ChatGPT plan and the keys notice open through doors', () => {
    for (const one of [localCli, chatgptPlan, checkKeysMoved, loadKeysMoved, loadPlanRows]) {
      expect(typeof one).toBe('function')
    }
  })

  test('signing in to a local program answers no while no module lends a terminal', async () => {
    const { signIn } = await localCli()
    await expect(signIn('claude-code', '/usr/bin/claude')).resolves.toBe(false)
  })
})

describe('what a mode allows', () => {
  test('a mode asked for is never more than the one held', () => {
    expect(noMoreThan('full', 'auto')).toBeNull()
    expect(noMoreThan('auto', 'approve')).toBeNull()
    expect(noMoreThan('plan', 'approve')).toBeNull()
    expect(noMoreThan('approve', 'auto')).toBe('approve')
    for (const asked of MODES) expect(noMoreThan(asked, 'full')).toBe(asked)
  })

  test('a grant that asks for confirmation acts only on approval', () => {
    expect(modeOfGrant('confirm')).toBe('approve')
    expect(modeOfGrant('unsupervised')).toBe('auto')
    expect(modeOfGrant('autonomous')).toBe('full')
  })

  test('the older words for a mode still read, and nothing else does', () => {
    expect(modeIn('ask')).toBe('approve')
    expect(modeIn('agent')).toBe('full')
    expect(modeIn('everything')).toBeNull()
  })
})

describe('the providers', () => {
  test('every kind has a name, and the local ones are offered only on a desktop', () => {
    for (const kind of offeredKinds(true, true)) expect(KIND_NAMES[kind]).toBeTruthy()
    expect(offeredKinds(false, true).some((kind) => isLocal(kind))).toBe(false)
  })

  test('models that cannot chat are left out, and the newest one is first', () => {
    expect(talkable('openai', ['gpt-4.1', 'whisper-1', 'text-embedding-3-small'])).toEqual([
      'gpt-4.1',
    ])
    expect(firstModel('anthropic', ['claude-sonnet-4-5', 'claude-sonnet-4'])).toBe(
      'claude-sonnet-4-5',
    )
  })

  test('a stream is read line by line, with a part line kept for the next chunk', () => {
    const first = sseLines('', 'data: {"a":1}\ndata: {"b"')
    expect(first.payloads).toEqual(['{"a":1}'])
    const second = sseLines(first.rest, ':2}\n')
    expect(second.payloads.map((one) => sseJson(one))).toEqual([{ b: 2 }])
    expect(sseJson('[DONE]')).toBeNull()
  })
})
