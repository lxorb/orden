import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { Ground, loadSignIn, LogoTile, Mark, Screen, SignIn } from '../src/api'

const SRC = join(import.meta.dirname, '../src')
describe('the module stands on its own', () => {
  test('offers the screen, its ground and the log in as components, and the whole first screen through a door', () => {
    for (const one of [Ground, LogoTile, Mark, Screen, SignIn, loadSignIn]) expect(typeof one).toBe('function')
  })
  test('reaches nothing but the account and the kit, so an app with no workspace can open on it', () => {
    const reached = new Set<string>()
    for (const name of readdirSync(SRC)) {
      for (const [, module] of readFileSync(join(SRC, name), 'utf8').matchAll(/from '\.\.\/\.\.\/([a-z-]+)\/src\//g)) {
        if (module) reached.add(module)
      }
    }
    expect([...reached].sort()).toEqual(['accounts', 'ui-kit'])
  })
  test('draws every shared class it uses itself, so the screen looks the same outside the setup', () => {
    const ground = readFileSync(join(SRC, 'Ground.svelte'), 'utf8')
    const used = new Set<string>()
    for (const name of readdirSync(SRC).filter((one) => one.endsWith('.svelte'))) {
      for (const [, classes] of readFileSync(join(SRC, name), 'utf8').matchAll(/class="([^"{}]+)"/g)) {
        for (const one of (classes ?? '').split(/\s+/)) if (one.startsWith('o-')) used.add(one)
      }
    }
    expect([...used].sort()).toEqual(['o-error', 'o-field'])
    for (const one of used) expect(ground, one).toContain(`.ground :global(.${one})`)
  })
})
