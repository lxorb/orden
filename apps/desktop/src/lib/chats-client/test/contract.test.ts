import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { headingAbove, sentWords } from '../src/sent-words'
import { levelWord } from '../src/level-words'
import { recordVoice } from '../src/voice'

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
})

describe('a note sent to a chat', () => {
  test('is its link alone, or the quoted lines above a link to the heading they sit under', () => {
    expect(sentWords('Plan')).toBe('[[Plan]] ')
    expect(sentWords('Plan', { text: 'one\n\ntwo', heading: 'Goals' })).toBe(
      '> one\n>\n> two\n\n[[Plan#Goals]] ',
    )
  })

  test('finds the nearest heading above where the quote starts', () => {
    const text = '# Plan\n\n## Goals\nship it\n'
    expect(headingAbove(text, text.indexOf('ship'))).toBe('Goals')
    expect(headingAbove('no heading here', 5)).toBeNull()
  })
})

describe('how urgent a message is', () => {
  test('reads as a word for every level', () => {
    expect(
      ['urgent', 'important', 'if-time', 'unimportant'].map((one) => levelWord(one as never)),
    ).toEqual(['Urgent', 'Important', 'If time', 'Unimportant'])
  })
})

describe('the voice', () => {
  test('is refused with a reason while no module has bound the voice port', async () => {
    await expect(recordVoice()).rejects.toThrow(/voice/)
  })
})
