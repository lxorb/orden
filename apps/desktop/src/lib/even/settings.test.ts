import { DEFAULT_COMPACTION } from '@nib/glasses'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The one schema both surfaces are drawn from.
 *
 *  Two things are checked here and they are the two that went wrong. Emil: "the
 *  show page number setting is currently pretty broken: I turned it off and then on
 *  but now there's no page number anymore, and it didn't update responsively." The
 *  second half of that is the bridge's; the first half is this file's - a setting
 *  that does not come back when it is set back.
 *
 *  So every setting there is gets the same test, by walking the schema rather than
 *  by being listed: set it to something else, set it back, and both the value and
 *  the stamp the panel watches are where they started. A setting added tomorrow is
 *  covered by having been added. */

vi.mock('../api', () => ({ api: {} }))
vi.mock('../account.svelte', () => ({ account: { accountToken: null } }))
vi.mock('../i18n.svelte', () => ({
  t: (text: string) => text,
  key: (text: string) => text,
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('document', { documentElement: { style: { setProperty: () => undefined } } })

const { glassesGroups, glassesSettings, glassesStamp, resetGlasses, wordFields } =
  await import('./settings')

beforeEach(() => {
  localStorage.clear()
  resetGlasses()
})

/** Something this setting is not set to now. */
function otherThan(field: ReturnType<typeof glassesSettings>[number]['field']): unknown {
  if (field.kind === 'switch') return !field.get()
  if (field.kind === 'select') {
    return field.options.find((one) => one.value !== field.get())?.value
  }
  if (field.kind === 'slider') return field.get() === field.max ? field.min : field.max

  return 'something else'
}

describe('every glasses setting', () => {
  test.each(glassesSettings().map((one) => [one.id, one] as const))(
    '%s comes back when it is set back',
    (_id, setting) => {
      const field = setting.field
      const was = field.get()
      const stamp = glassesStamp()

      const other = otherThan(field)
      expect(other, 'nothing else to set it to').not.toBeUndefined()

      // Written out per kind rather than through one call, because the setters are
      // typed one per kind and a cast here would be a test of the cast.
      if (field.kind === 'switch') field.set(other as boolean)
      else if (field.kind === 'slider') field.set(other as number)
      else field.set(other as string)

      expect(field.get()).toBe(other)
      expect(glassesStamp()).not.toBe(stamp)

      if (field.kind === 'switch') field.set(was as boolean)
      else if (field.kind === 'slider') field.set(was as number)
      else field.set(was as string)

      expect(field.get()).toBe(was)
      // The whole of what the panel watches, back where it was: this is what makes
      // "off and then on again" the same as never having touched it.
      expect(glassesStamp()).toBe(stamp)
    },
  )

  test('says what it started as, so both surfaces can put it back', () => {
    for (const { id, field } of glassesSettings()) {
      expect(field.initial, id).not.toBeUndefined()
    }
  })

  /** Emil, after reading on a pair: the lines he wrote are the lines he meant. The
   *  default is declared once, in @nib/glasses, and both the schema's initial and the
   *  store's default read it - so a reader who has never chosen gets `collapse` and a
   *  device that saved a value keeps it. */
  test('starts a note at one break between blocks, not at as little as possible', () => {
    const found = glassesSettings().find((one) => one.id === 'compaction')

    expect(found?.field.initial).toBe(DEFAULT_COMPACTION)
    expect(DEFAULT_COMPACTION).toBe('collapse')
    expect(found?.field.get()).toBe('collapse')
  })

  test('is on the glasses, because all of them make sense there', () => {
    expect(glassesSettings().every((one) => one.onGlasses)).toBe(true)
  })
})

describe('the schema', () => {
  test('groups the phone’s pane in the order it lists them', () => {
    const groups = glassesGroups()

    expect(groups.map((one) => one.title)).toEqual(['Reading', 'Markdown on the panel', 'Voice'])
    // Every setting is in exactly one group, and none is lost on the way.
    const fields = groups.flatMap((one) => one.fields)
    expect(fields).toHaveLength(glassesSettings().length)
  })

  test('offers the markers rule one starts from', () => {
    const marks = glassesSettings().filter((one) => one.id.startsWith('mark.'))
    const on = marks.filter((one) => one.field.get() === true).map((one) => one.id)

    // Code marked, everything that only styles words dropped. Emil's rule.
    expect(on).toEqual(['mark.fence', 'mark.code'])
  })

  test('keeps the spoken phrases off the glasses, which cannot type', () => {
    const words = wordFields()

    expect(words.length).toBeGreaterThan(5)
    for (const field of words) expect(field.kind).toBe('text')
    // None of them is in the schema the glasses walk.
    expect(glassesSettings().some((one) => one.field.kind === 'text')).toBe(false)
  })

  test('puts every setting back, from either surface', () => {
    const settings = glassesSettings()
    for (const { field } of settings) {
      if (field.kind === 'switch') field.set(!field.get())
    }

    resetGlasses()

    for (const { id, field } of settings) {
      expect(field.get(), id).toBe(field.initial)
    }
  })
})
