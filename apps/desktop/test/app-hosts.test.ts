import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { entryOf, ORDEN_APPS } from '../app-build'

const APP = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(APP, 'src')
const HOSTS = ['SheetMenu', 'SheetPrompt', 'OwnUndo'] as const
function rootOf(app: string): string | null {
  const entry = join(SRC, `${app}.ts`)
  if (entryOf(app as (typeof ORDEN_APPS)[number]) === 'index.html' || !existsSync(entry)) return null
  const found = /from '\.\/lib\/([a-z-]+-app)\/src\/api'/.exec(readFileSync(entry, 'utf8'))
  return found?.[1] ? join(SRC, 'lib', found[1], 'src') : null
}
describe('a phone app with a root of its own (#2286)', () => {
  const apps = ORDEN_APPS.flatMap((app) => {
    const root = rootOf(app)
    return root ? [{ app, root }] : []
  })
  test('is found by its entry, Orden Track among them', () => {
    expect(apps.map((one) => one.app)).toContain('track')
    for (const app of ORDEN_APPS) {
      if (entryOf(app) === 'index.html' || !existsSync(join(SRC, `${app}.ts`))) continue
      expect(rootOf(app), `${app} names no <app>-app module in its entry`).not.toBe(null)
    }
  })
  test('draws the menus, the prompts and the Undo its parts ask for, which the whole Orden’s window draws for them elsewhere', () => {
    for (const { app, root } of apps) {
      const drawn = readdirSync(root)
        .filter((name) => name.endsWith('.svelte'))
        .map((name) => readFileSync(join(root, name), 'utf8'))
        .join('\n')
      for (const host of HOSTS) {
        expect(drawn, `${app} mounts no ${host}`).toMatch(new RegExp(`<${host}\\s*/>`))
        expect(drawn, `${app} takes ${host} from somewhere else`).toMatch(
          new RegExp(`import \\{[^}]*\\b${host}\\b[^}]*\\} from '\\.\\./\\.\\./(ui-controls|undo-toast)/src/api'`),
        )
      }
    }
  })
  test('has those hosts in modules every app may carry', () => {
    const controls = readFileSync(join(SRC, 'lib', 'ui-controls', 'src', 'api.ts'), 'utf8')
    expect(controls).toContain("export { default as SheetMenu } from './SheetMenu.svelte'")
    expect(controls).toContain("export { default as SheetPrompt } from './SheetPrompt.svelte'")
    expect(readFileSync(join(SRC, 'lib', 'undo-toast', 'src', 'api.ts'), 'utf8')).toContain(
      "export { default as OwnUndo } from './OwnUndo.svelte'",
    )
    for (const name of ['SheetMenu.svelte', 'SheetPrompt.svelte'])
      expect(readFileSync(join(SRC, 'lib', 'ui-controls', 'src', name), 'utf8')).toMatch(
        /import \{ [^}]*\b(menu|prompt)\b[^}]* \} from '\.\.\/\.\.\/ui-kit\/src\/api'/,
      )
  })
})
