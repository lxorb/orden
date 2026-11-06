import { describe, expect, test } from 'vitest'
import { ownKeysTaken, withOwnKeys } from './own-keys'

const NOTE = '# Plan\n\nWords.\n'

describe("Orden's own keys in a note's text", () => {
  test('come out of the front matter whole, and the rest of it stays as written', () => {
    const text = `---\ntitle: Plan\nicon: rocket\nicon-color: red\ncover: "[[pics/sea.png]]"\ncover-position: 30\n---\n\n${NOTE}`
    expect(ownKeysTaken(text)).toEqual({
      meta: { icon: 'rocket', 'icon-color': 'red', cover: 'pics/sea.png', 'cover-position': '30' },
      text: `---\ntitle: Plan\n---\n\n${NOTE}`,
    })
  })

  test('take the front matter away where nothing else was in it', () => {
    expect(ownKeysTaken(`---\nicon: rocket\n---\n\n${NOTE}`)).toEqual({
      meta: { icon: 'rocket' },
      text: NOTE,
    })
  })

  test('leave a note with none alone, and a colour with no icon is no colour', () => {
    expect(ownKeysTaken(NOTE)).toBeNull()
    expect(ownKeysTaken(`---\ntags: [a]\n---\n${NOTE}`)).toBeNull()
    expect(ownKeysTaken(`---\nicon-color: red\n---\n\n${NOTE}`)).toEqual({ meta: {}, text: NOTE })
  })

  test('go back into an export, and an export brought back in gives the same metadata', () => {
    const meta = {
      icon: 'rocket',
      'icon-color': 'violet',
      cover: 'pics/sea photo.png',
      'cover-position': '70',
    }
    const exported = withOwnKeys(NOTE, meta)
    expect(exported.startsWith('---\n')).toBe(true)
    expect(ownKeysTaken(exported)).toEqual({ meta, text: NOTE })
    expect(withOwnKeys(NOTE, null)).toBe(NOTE)
    expect(withOwnKeys(NOTE, { other: 'x' })).toBe(NOTE)
  })
})
