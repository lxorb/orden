import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const APP = readFileSync(join(import.meta.dirname, '../src/App.svelte'), 'utf8')

const CONFIG = readFileSync(join(import.meta.dirname, '../vite.config.ts'), 'utf8')

const START = readFileSync(join(import.meta.dirname, '../src/lib/start.ts'), 'utf8')

function handle(): string {
  const opening = 'ordenApp: {'
  const from = APP.indexOf(opening)
  expect(from, 'no ordenApp on the window').toBeGreaterThanOrEqual(0)

  let depth = 1
  let at = from + opening.length
  while (depth > 0 && at < APP.length) {
    const character = APP[at]
    if (character === '{') depth += 1
    if (character === '}') depth -= 1
    at += 1
  }

  return APP.slice(from, at)
}

describe('the handle a drive reads the app through', () => {
  const listed = handle()

  test('it is behind the constant that says a build may be driven', () => {
    expect(APP).toContain('if (__DRIVEABLE__)')
    expect(APP.indexOf('if (__DRIVEABLE__)')).toBeLessThan(APP.indexOf('ordenApp: {'))
    expect(APP).not.toContain('if (import.meta.env.DEV)')
  })

  test('and that constant is false in a release', () => {
    const said = /__DRIVEABLE__:\s*JSON\.stringify\(([\s\S]*?)\),?\s*\}/u.exec(CONFIG)?.[1] ?? ''
    const ways = said
      .replace(/,\s*$/u, '')
      .split('||')
      .map((one) => one.replace(/\s+/gu, ' ').trim())

    expect(ways.length).toBeGreaterThan(0)
    for (const way of ways) {
      expect(["command === 'serve'", "mode === 'drive'", "mode === 'development'"]).toContain(way)
    }
  })

  test('a build that may be driven sends no usage and no crash reports to the real server', () => {
    expect(START).toContain('const reporting = !import.meta.env.DEV && !__DRIVEABLE__')
    expect(START).toContain('one.watchUsage(reporting)')
    expect(START).toContain('one.watchCrashes(reporting)')
    expect(START.match(/\.watch(Usage|Crashes)\(/gu)).toHaveLength(2)
  })

  test.each([
    'account',
    'busy',
    'fullscreen',
    'iconChoice',
    'links',
    'modes',
    'overlays',
    'pages',
    'pull',
    'rooms',
    'search',
    'settings',
    'share',
    'shortcuts',
    'sync',
    'theme',
    'toolbar',
    'viewport',
    'views',
    'workspace',
  ])('%s is on it', (name) => {
    expect(listed).toMatch(new RegExp(`(^|[\\s,])${name},`))
  })

  test.each(['ai', 'importing', 'publish', 'rewriting', 'themeStore'])(
    '%s arrives on it later',
    (name) => {
      const later = APP.slice(APP.indexOf('ordenApp: {') + listed.length)
      expect(later).toContain(`Object.assign((window as unknown as { ordenApp: object }).ordenApp`)
      expect(later).toMatch(new RegExp(`${name}[,:]`))
    },
  )

  test('a drive written before the rename still finds the app and the editor by their old names', () => {
    expect(APP).toContain('nibApp: (window as unknown as { ordenApp: object }).ordenApp')
    const editor = readFileSync(join(import.meta.dirname, '../src/lib/Editor.svelte'), 'utf8')
    expect(editor).toContain('Object.assign(window, { orden: created, [FORMER_HANDLE]: created })')
    expect(editor).toContain("const FORMER_HANDLE = 'nib'")
  })
})
