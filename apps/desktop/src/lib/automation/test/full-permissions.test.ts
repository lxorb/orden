import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { callerOf, fullPermissions, holds } from '../src/api'

const LIB = join(import.meta.dirname, '..', '..')
const DECIDES = 'automation/src/caller.ts'

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

const OWN_DECISION = [/\bmode\s*[!=]==?\s*'autonomous'/, /\bagent\??\.scopes\??\.(includes|every|some)\(/]

describe('what an agent holds', () => {
  test('is the crate’s Grant::holds: every scope under Full permissions, the listed ones otherwise', () => {
    for (const mode of ['autonomous', 'unsupervised', 'confirm']) {
      const caller = callerOf({ id: 'a', scopes: ['notes.read'], spaces: 'all', mode })
      expect(holds(caller, 'notes.read'), mode).toBe(true)
      expect(holds(caller, 'terminal'), mode).toBe(mode === 'autonomous')
      expect(fullPermissions(caller.agent), mode).toBe(mode === 'autonomous')
    }
    expect(fullPermissions(callerOf({ id: 'a', mode: 'whatever' }).agent)).toBe(false)
  })

  test('is decided in one place, which every check of a caller’s mode or scopes asks', () => {
    const own = sources(LIB).flatMap((path) => {
      const where = relative(LIB, path).replaceAll('\\', '/')
      if (where === DECIDES) return []
      return readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, at) =>
          OWN_DECISION.some((one) => one.test(line)) ? [`${where}:${at + 1}: ${line.trim()}`] : [],
        )
    })
    expect(own).toEqual([])
  })
})
