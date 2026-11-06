import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const APP = readFileSync(fileURLToPath(new URL('../src/App.svelte', import.meta.url)), 'utf8')

const CONFIG = readFileSync(fileURLToPath(new URL('../vite.config.ts', import.meta.url)), 'utf8')

function handle(): string {
  const opening = 'nibApp: {'
  const from = APP.indexOf(opening)
  expect(from, 'no nibApp on the window').toBeGreaterThanOrEqual(0)

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
    expect(APP.indexOf('if (__DRIVEABLE__)')).toBeLessThan(APP.indexOf('nibApp: {'))
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

  test.each([
    'account',
    'busy',
    'fullscreen',
    'iconChoice',
    'links',
    'modes',
    'overlays',
    'pages',
    'present',
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
      const later = APP.slice(APP.indexOf('nibApp: {') + listed.length)
      expect(later).toContain(`Object.assign((window as unknown as { nibApp: object }).nibApp`)
      expect(later).toMatch(new RegExp(`${name}[,:]`))
    },
  )
})
