import { describe, expect, test } from 'vitest'
import { inLanguageOrder } from './language-order'

const rows = (...names: string[]) => names.map((name) => ({ id: name, name }))
const names = (list: { name: string }[]) => list.map((one) => one.name)

describe('a language list', () => {
  test('keeps the system default first', () => {
    const list = [...rows('Polski', 'Deutsch'), { id: 'system', name: 'Wie das System' }]

    expect(inLanguageOrder(list).map((one) => one.id)).toEqual(['system', 'Deutsch', 'Polski'])
  })

  test('sorts the Latin names A to Z, accents with their letter', () => {
    const list = rows(
      'Türkçe',
      'Österreichisch',
      'Español',
      'Čeština',
      'English',
      'Deutsch',
      'Tiếng Việt',
      'Polski',
      'Català',
    )

    expect(names(inLanguageOrder(list))).toEqual([
      'Català',
      'Čeština',
      'Deutsch',
      'English',
      'Español',
      'Österreichisch',
      'Polski',
      'Tiếng Việt',
      'Türkçe',
    ])
  })

  test('puts every other script after the Latin ones, one script at a time', () => {
    const list = rows(
      '日本語',
      'Русский',
      'हिन्दी',
      'ไทย',
      'العربية',
      'Ελληνικά',
      'עברית',
      'Zulu',
      '한국어',
      'Ąžuolas',
      'Українська',
    )

    expect(names(inLanguageOrder(list))).toEqual([
      'Ąžuolas',
      'Zulu',
      'Ελληνικά',
      'Русский',
      'Українська',
      'עברית',
      'العربية',
      'हिन्दी',
      'ไทย',
      '한국어',
      '日本語',
    ])
  })

  test('sorts the names inside one script', () => {
    expect(names(inLanguageOrder(rows('Українська', 'Русский', 'Беларуская')))).toEqual([
      'Беларуская',
      'Русский',
      'Українська',
    ])
  })

  test('leaves the list it was given as it was', () => {
    const list = rows('Polski', 'Deutsch')
    inLanguageOrder(list)

    expect(names(list)).toEqual(['Polski', 'Deutsch'])
  })
})
