import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SCRIPTS = join(ROOT, 'scripts')
const WORKFLOWS = join(ROOT, '.github', 'workflows')

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')

const SURFACES = read(ROOT, 'apps', 'desktop', 'src', 'lib', 'surfaces.svelte.ts')
const ASK = read(ROOT, 'apps', 'desktop', 'src', 'lib', 'crash-reports', 'src', 'CrashAsk.svelte')
const TOLD = read(SCRIPTS, 'crash_told.py')

const constant = (name: string) =>
  new RegExp(`export const ${name} = '([^']+)'`).exec(SURFACES)?.[1] ?? ''

const run = new Set(
  readdirSync(WORKFLOWS)
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((name) =>
      [...read(WORKFLOWS, name).matchAll(/scripts\/([\w-]+\.py)\b/g)].map(
        (found) => found[1] ?? '',
      ),
    ),
)

const script = (name: string) => read(SCRIPTS, name)

const launchers = [...run]
  .filter((name) => readdirSync(SCRIPTS).includes(name))
  .filter((name) => script(name).includes('automation.json'))
  .sort()

function answers(name: string, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false
  seen.add(name)
  const text = script(name)
  if (/\bcrash_told\.told\(/.test(text)) return true
  return [...text.matchAll(/import_module\("([\w-]+)"\)/g)].some((found) =>
    answers(`${found[1] ?? ''}.py`, seen),
  )
}

describe('a drive CI runs on a fresh profile', () => {
  test('is found', () => {
    expect(launchers).toContain('pinch-drive.py')
    expect(launchers).toContain('outside-drop-drive.py')
    expect(launchers).toContain('web-tab-drive.py')
  })

  test('answers the first-start crash-report question as soon as the app answers', () => {
    expect(launchers.filter((name) => !answers(name))).toEqual([])
  })

  test('ends the app through fresh_app, so the whole process tree goes on Windows', () => {
    const bare = /\b(?:process|app|self\.process)\.(?:kill|terminate)\(\)/
    expect(launchers.filter((name) => bare.test(script(name)))).toEqual([])
  })

  test('clears its config folder through fresh_app, which waits for it to go', () => {
    const bare = /rmtree\((?:config|config_dir\([^)]*\))\b|\bconfig\.mkdir\(parents=True\)/
    expect(launchers.filter((name) => bare.test(script(name)))).toEqual([])
  })
})

describe('what crash_told answers', () => {
  test('is the question the app asks, under the keys it keeps the answer in', () => {
    expect(TOLD).toContain(`TOLD = "${constant('CRASHES_ASKED')}"`)
    expect(TOLD).toContain(`REPORTS = "${constant('CRASH_REPORTS')}"`)
    expect(constant('CRASHES_ASKED')).not.toBe('')
    expect(constant('CRASH_REPORTS')).not.toBe('')
  })

  test('finds the sheet, its box and its button as the app draws them', () => {
    expect(TOLD).toContain(`.orden-screen.sheet[role="dialog"]`)
    expect(ASK).toMatch(/class="orden-screen[^"]*\bsheet\b[^"]*"[\s\S]{0,80}role="dialog"/)
    expect(TOLD).toContain('input.orden-checkbox')
    expect(ASK).toMatch(/<input type="checkbox" class="orden-checkbox"/)
    expect(TOLD).toContain('button[data-lands]')
    expect(ASK).toMatch(/<button[^>]*\bdata-lands\b/)
  })
})
