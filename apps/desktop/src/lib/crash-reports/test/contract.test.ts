import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { crashReports, loadCrashAsk, watchCrashes } from '../src/api'
import { scrubbedText } from '../src/scrub'

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

  test('the api loads with nothing watched and the question closed, and every call is there', () => {
    for (const one of [loadCrashAsk, watchCrashes]) expect(typeof one).toBe('function')
    expect(typeof crashReports.on).toBe('boolean')
  })
})

describe('what a crash report may carry', () => {
  test('no secret, address or page path leaves the device', () => {
    const text = scrubbedText(
      'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl mail anna@example.org https://bank.example.com/login?account=42',
    )
    expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(text).not.toContain('anna@example.org')
    expect(text).not.toContain('/login?account=42')
  })

  test('an answer is taken only while the question is open', () => {
    crashReports.set(true)
    crashReports.answer(false)
    expect(crashReports.on).toBe(true)
  })
})
