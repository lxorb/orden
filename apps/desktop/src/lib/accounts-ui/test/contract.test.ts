import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { Avatar, card, DeleteAccount, Faces, profileRows, Security, SignIn } from '../src/api'

const SRC = join(import.meta.dirname, '../src')

describe('the module stands on its own', () => {
  test('reads the account only through its api', () => {
    const reaching = readdirSync(SRC).filter((name) =>
      /accounts\/src\/(?!api')/.test(readFileSync(join(SRC, name), 'utf8')),
    )
    expect(reaching).toEqual([])
  })

  test('offers the sheets and the faces as components, and no card is open', () => {
    for (const one of [Avatar, Faces, Security, SignIn, DeleteAccount, profileRows]) {
      expect(typeof one).toBe('function')
    }
    expect(card.shown).toBeNull()
  })
})
