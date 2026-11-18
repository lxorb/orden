import { describe, expect, test } from 'vitest'
import {
  answerOf,
  asked,
  type Call,
  count,
  done,
  flag,
  gatedBy,
  maybe,
  need,
  needScope,
  Refused,
  short,
  verbsOf,
  writerOf,
} from '../src/api'

const READER = { agent: null }

function agent(scopes: string[], mode: 'unsupervised' | 'confirm' | 'autonomous' = 'confirm') {
  return {
    agent: {
      id: 'claude',
      builtIn: false,
      name: 'Claude',
      scopes,
      spaces: 'all' as const,
      mode,
      programs: [],
      sites: {},
    },
  }
}

function call(args: Record<string, unknown>, caller: Call['caller'] = READER): Call {
  return { verb: 'read_note', args, caller }
}

describe('what a verb was told', () => {
  test('a word it needs, one it may have, a flag and a count within bounds', () => {
    const told = call({ path: ' Plan.md ', quiet: 'yes', lines: '900', empty: '  ' })
    expect(need(told, 'path')).toBe('Plan.md')
    expect(() => need(told, 'empty')).toThrow(Refused)
    expect(maybe(told, 'missing')).toBeNull()
    expect(flag(told, 'quiet')).toBe(true)
    expect(count(told, 'lines', 10, 500)).toBe(500)
    expect(count(told, 'none', 10, 500)).toBe(10)
    expect(() => short('query', 'x'.repeat(1001))).toThrow(Refused)
  })

  test('the writer is the agent, or orden for the command line', () => {
    expect(writerOf(call({}))).toEqual({ id: 'cli', name: 'orden' })
    expect(writerOf(call({}, agent([])))).toEqual({ id: 'claude', name: 'Claude' })
  })

  test('a scope the agent was not granted is refused; the reader holds every scope', () => {
    expect(() => needScope(call({}, agent(['notes.read'])), 'tree', 'moving')).toThrow(Refused)
    expect(() => needScope(call({}), 'tree', 'moving')).not.toThrow()
  })

  test('an agent under Full permissions holds every scope, whatever its grant kept', () => {
    const full = call({}, agent(['notes.read'], 'autonomous'))
    expect(() => needScope(full, 'tree', 'moving')).not.toThrow()
    expect(() => needScope(full, 'workspace.focus', 'a split')).not.toThrow()
  })
})

describe('answers', () => {
  test('a result, marked untrusted when it says where it came from', () => {
    expect(done(1)).toEqual({ ok: true, status: 'ok', result: 1 })
    expect(done(1, 'a web page')).toMatchObject({ untrusted: 'a web page' })
  })

  test('a refusal keeps its code, and anything else thrown fails', () => {
    expect(answerOf(new Refused('protected', 'no'))).toMatchObject({ code: 'protected' })
    expect(answerOf(new Error('broke'))).toMatchObject({ code: 'failed', message: 'broke' })
  })

  test('the reader and an agent with full permissions are never asked', async () => {
    expect(await asked(call({}), 'writing', 'Write Plan.md')).toBeNull()
    expect(await asked(call({}, agent([], 'autonomous')), 'writing', 'Write Plan.md')).toBeNull()
  })
})

describe('a table of verbs', () => {
  test('answers what a verb throws, and a gate turned off refuses before the verb runs', async () => {
    let ran = 0
    const verbs = verbsOf({
      fine: (told) => done(told.verb),
      broken: () => {
        throw new Refused('no_such_file', 'gone')
      },
      gated: gatedBy(
        () => false,
        'databases are',
        () => {
          ran += 1
          return done(null)
        },
      ),
    })
    expect(await verbs.fine?.('fine', {}, READER)).toEqual(done('fine'))
    expect(await verbs.broken?.('broken', {}, READER)).toMatchObject({ code: 'no_such_file' })
    expect(await verbs.gated?.('gated', {}, READER)).toMatchObject({ code: 'not_granted' })
    expect(ran).toBe(0)
  })
})
