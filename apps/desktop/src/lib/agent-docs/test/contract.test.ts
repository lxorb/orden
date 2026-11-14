import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { agentDocs, DocError, inTurn, plan, readEdits, revOf, touchedBy } from '../src/api'

const followed = vi.hoisted(() => [] as unknown[])
vi.mock('../../workspace.svelte', () => ({
  workspace: { fileOps: { follow: (one: unknown) => followed.push(one) } },
}))

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

  test('the note docs open through a door', () => {
    expect(typeof agentDocs).toBe('function')
  })

  test('the api loads without the note docs, which follow file moves only once opened', () => {
    expect(followed).toEqual([])
  })
})

describe('a note an agent reads', () => {
  test('has one revision for the same words and another for other words', () => {
    expect(revOf('plan')).toBe(revOf('plan'))
    expect(revOf('plan')).not.toBe(revOf('plans'))
  })

  test('was touched by nobody while no agent wrote to it', () => {
    expect(touchedBy('notes/a.md')).toEqual([])
    expect(touchedBy(null)).toEqual([])
  })
})

describe('turns', () => {
  test('runs taken under one key wait for each other, even past a failure', async () => {
    const order: string[] = []
    const first = inTurn('a.md', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push('first')
      throw new Error('refused')
    })
    const second = inTurn('a.md', async () => {
      order.push('second')
      return 2
    })
    await expect(first).rejects.toThrow('refused')
    await expect(second).resolves.toBe(2)
    expect(order).toEqual(['first', 'second'])
  })
})

describe('the edits an agent asks for', () => {
  test('are read from the wire and placed in the words they name', () => {
    const text = 'The plan is simple.'
    const planned = plan(readEdits([{ at: { quote: 'simple' }, replace: 'late' }]), text)
    expect(planned.edits).toEqual([{ from: 12, to: 18, insert: 'late' }])
  })

  test('are refused with a doc error when they do not say one thing', () => {
    expect(() => readEdits([])).toThrow(DocError)
    expect(() => readEdits([{ at: { end: true } }])).toThrow(DocError)
  })

  test('are refused when two change the same words', () => {
    const asked = readEdits([
      { at: { quote: 'plan' }, replace: 'idea' },
      { at: { quote: 'plan is' }, replace: 'goal was' },
    ])
    expect(() => plan(asked, 'The plan is simple.')).toThrow(DocError)
  })
})
