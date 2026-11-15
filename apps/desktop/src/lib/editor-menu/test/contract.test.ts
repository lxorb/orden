import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { showEditorMenu } from '../src/api'

const SOURCE = readFileSync(join(import.meta.dirname, '../src/editor-menu.ts'), 'utf8')

describe('the editor menu', () => {
  test('is shown by one call', () => {
    expect(typeof showEditorMenu).toBe('function')
  })

  test('takes what features add from the command rows they register', () => {
    for (const place of ['rewrite', 'send', 'transcribe']) {
      expect(SOURCE).toContain(`rowsFor('${place}'`)
    }
  })
})
