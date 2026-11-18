import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

vi.stubGlobal('localStorage', (await import('../../../../test/disk')).memoryStorage())
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
  test('hands an agent verb the deadline the window was given', async () => {
    const { registerAgentVerbs } = await import('@orden/contracts')
    const given: (AbortSignal | undefined)[] = []
    const stop = registerAgentVerbs(() =>
      Promise.resolve({
        read_note: (_name, _args, _caller, deadline) => {
          given.push(deadline)
          return Promise.resolve({ ok: true as const, status: 'ok' as const, result: {} })
        },
      }),
    )
    const deadline = new AbortController().signal
    await dispatch('read_note', {}, [], 'here', { agent: null }, deadline)
    stop()
    expect(given).toEqual([deadline])
  })

  test('answers its own list of verbs', async () => {
    expect(await verbs()).toContain('files.read')
  })

  test('says so plainly about a verb that does not exist', async () => {
    expect(await dispatch('nonsense', {})).toEqual({
      ok: false,
      error: 'there is no verb called nonsense',
    })
  })

  test.each(['files', 'tags'])(
    'joins %s list into one verb only where the two words are one, as a terminal sends it',
    async (verb) => {
      expect(await dispatch(verb, {}, ['list'])).toEqual({
        ok: false,
        error: 'there is no space open',
      })
    },
  )

  test('will not change anything until the caller says yes', async () => {
    for (const verb of ['files.write', 'files.move', 'files.delete', 'properties.set', 'eval']) {
      expect(await dispatch(verb, {}), verb).toEqual({
        ok: false,
        error: `${verb} changes something: say yes to go ahead`,
      })
    }
  })

  test('refuses words past a move’s two paths rather than guessing where one ends', async () => {
    expect(await dispatch('files', { yes: true }, ['move', 'My', 'plan.md', 'Later.md'])).toEqual({
      ok: false,
      error: 'files.move takes path and to, one word each: quote a path with spaces in it',
    })
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
    const usage = readFileSync(join(import.meta.dirname, '../../../../../cli/orden.mjs'), 'utf8')

    const missing = (await verbs())
      .filter((verb) => !verb.includes('_') && !verb.startsWith('agent.'))
      .filter((verb) => !usage.includes(`  ${verb.replace('.', ' ')}`))
    expect(missing).toEqual([])
  })
})
