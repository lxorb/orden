import { afterAll, expect, test } from 'vitest'
import { i18n } from './i18n.svelte'

const Real = Intl.PluralRules
let made = 0

class Counted extends Real {
  constructor(...asked: ConstructorParameters<typeof Real>) {
    super(...asked)
    made += 1
  }
}

Reflect.set(Intl, 'PluralRules', Counted)

afterAll(() => {
  Reflect.set(Intl, 'PluralRules', Real)
})

test('a long list of counted rows builds the language’s plural rules once, not once a row', () => {
  for (let count = 0; count < 200; count++) {
    i18n.plural(count, { one: '{count} note', other: '{count} notes' })
  }

  expect(i18n.plural(1, { one: '{count} note', other: '{count} notes' })).toBe('1 note')
  expect(made).toBeLessThanOrEqual(1)
})
