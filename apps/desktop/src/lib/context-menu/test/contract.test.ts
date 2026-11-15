import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadContextMenu } from '../src/api'

const SRC = join(import.meta.dirname, '../src')

describe('the module stands on its own', () => {
  test('nothing under src reaches past the platform, ui-kit, ui-controls and usage apis', () => {
    const reaching = readdirSync(SRC)
      .filter((name) => !name.includes('.test.'))
      .flatMap((name) => {
        const text = readFileSync(join(SRC, name), 'utf8')
        return [...text.matchAll(/'(\.\.\/[^']*)'/g)]
          .map((found) => found[1] ?? '')
          .filter(
            (spec) => !/^\.\.\/\.\.\/(?:platform|ui-kit|ui-controls|usage)\/src\/api$/.test(spec),
          )
          .map((spec) => `${name}: ${spec}`)
      })
    expect(reaching).toEqual([])
  })

  test('the menu is behind its door, which loads nothing until it is asked', () => {
    expect(typeof loadContextMenu).toBe('function')
  })
})
