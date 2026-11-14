import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ACCENTS, accentColour, accentFor, accentIdFor } from '../accents'
import { readPerson } from './read'

const read = (path: string) => readFileSync(join(import.meta.dirname, path), 'utf8')

describe('the colour beside a person', () => {
  test('is their account’s own, the same every time and on every device', () => {
    expect(accentIdFor('u-ada')).toBe(accentIdFor('u-ada'))
    expect(ACCENTS.map((one) => one.id)).toContain(accentIdFor('u-ada'))
    expect(accentFor('u-ada', 'dark')).toBe(accentColour(accentIdFor('u-ada'), 'dark'))
    expect(accentFor('u-ada', 'light')).toBe(accentColour(accentIdFor('u-ada'), 'light'))
  })

  test('is not what an older build or the server says it was', () => {
    const person = readPerson({ id: 'u-ada', name: 'Ada', accent: 'teal' })
    expect(person).not.toBeNull()
    expect(person).not.toHaveProperty('accent')
  })

  test('has no picker in the profile, and the avatar takes it from the account', () => {
    expect(read('./ProfileRows.svelte')).not.toMatch(/Swatches|accent/)
    expect(read('./Avatar.svelte')).toContain('accentFor(face.key ?? face.name, theme.current)')
    expect(read('../collab/src/who.ts')).toContain('accentIdFor(user.id)')
  })
})
