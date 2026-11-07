import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

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
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

const { dispatch, isVerb, linkHearsFrom, verbForAction } = await import('./verbs')

async function verbs(): Promise<string[]> {
  const answered = await dispatch('verbs', {})
  expect(answered.ok).toBe(true)

  const value = answered.ok ? answered.value : null
  const said = (value as { verbs?: string[] } | null)?.verbs ?? []
  expect(said.length).toBeGreaterThan(20)

  return said
}

describe('the table', () => {
  test('answers its own list of verbs', async () => {
    expect(await verbs()).toContain('files.read')
  })

  test('says so plainly about a verb that does not exist', async () => {
    expect(await dispatch('nonsense', {})).toEqual({
      ok: false,
      error: 'there is no verb called nonsense',
    })
  })

  test('joins a verb written as two words, which is how a terminal sends one', async () => {
    expect(await dispatch('files', {}, ['list'])).toEqual({
      ok: false,
      error: 'there is no space open',
    })
  })

  test('leaves a one-word verb alone even when a value follows it', async () => {
    expect(await dispatch('tags', {}, ['list'])).toEqual({
      ok: false,
      error: 'there is no space open',
    })
  })

  test('will not change anything until the caller says yes', async () => {
    for (const verb of ['files.write', 'files.move', 'files.delete', 'properties.set', 'eval']) {
      expect(await dispatch(verb, {}), verb).toEqual({
        ok: false,
        error: `${verb} changes something: say yes to go ahead`,
      })
    }
  })

  test('answers rather than throwing when a verb says no', async () => {
    const answered = await dispatch('files.read', { path: '../outside.md' })
    expect(answered).toEqual({ ok: false, error: 'there is no space open' })
  })
})

describe('what a link may ask for', () => {
  test('is these six actions and nothing else', async () => {
    const actions = [...(await verbs()), 'command', 'add-task', 'nonsense']
    const allowed = actions.filter((one) => verbForAction(one) !== null)

    expect(allowed.sort()).toEqual(['add-task', 'append', 'command', 'new', 'open', 'search'])
  })

  test('reads `command` as the row the palette runs', () => {
    expect(verbForAction('command')).toBe('commands.run')
    expect(verbForAction('commands.run')).toBeNull()
  })

  test('and hears how it went only from the verbs that changed something', async () => {
    const heard = (await verbs()).filter((verb) => linkHearsFrom(verb))

    expect(heard).toEqual(['append', 'new', 'tasks.add'])
    expect(linkHearsFrom('open')).toBe(false)
    expect(linkHearsFrom('files.read')).toBe(false)
  })

  test('tells a verb it declines apart from a name it does not know', () => {
    expect(isVerb('files.delete')).toBe(true)
    expect(isVerb('command')).toBe(true)
    expect(isVerb('nonsense')).toBe(false)
  })
})

describe('the command line', () => {
  test('names every verb in its help, in the spelling a terminal takes', async () => {
    const usage = readFileSync(join(import.meta.dirname, '../../../../cli/nib.mjs'), 'utf8')

    const missing = (await verbs())
      .filter((verb) => !verb.includes('_') && !verb.startsWith('agent.'))
      .filter((verb) => !usage.includes(`  ${verb.replace('.', ' ')}`))
    expect(missing).toEqual([])
  })
})
