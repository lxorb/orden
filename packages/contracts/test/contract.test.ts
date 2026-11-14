import { describe, expect, it } from 'vitest'
import {
  ASK_EFFORTS,
  attempt,
  attemptAsync,
  EMPTY_EXTENSIONS,
  ENTRY_KINDS,
  err,
  failure,
  isEntryId,
  isAskEffort,
  isEntryKind,
  isEventName,
  isOk,
  isScheme,
  isSchemeChoice,
  isSpaceRole,
  isTabKind,
  isUlid,
  itemId,
  LONGEST_ID,
  mapResult,
  noteId,
  notePath,
  ok,
  portOf,
  portProvided,
  providePort,
  spaceId,
  TAB_KINDS,
  unixLines,
  unwrapOr,
  userId,
  webPages,
  whenPortProvided,
  type Result,
  type SpaceId,
} from '@orden/contracts'

describe('branded ids', () => {
  it('accepts a non-empty id up to the longest and refuses the rest', () => {
    expect(spaceId('abc')).toBe('abc')
    expect(spaceId('')).toBeNull()
    expect(spaceId('x'.repeat(LONGEST_ID))).toBe('x'.repeat(LONGEST_ID))
    expect(spaceId('x'.repeat(LONGEST_ID + 1))).toBeNull()
    expect(userId('u1')).toBe('u1')
  })

  it('keeps an entry id out of the file system', () => {
    expect(itemId('note-1')).toBe('note-1')
    expect(itemId('a/b')).toBeNull()
    expect(itemId('a\\b')).toBeNull()
    expect(itemId('..')).toBeNull()
    expect(itemId('a\u0000b')).toBeNull()
    expect(noteId('n')).toBe('n')
    expect(isEntryId('fine')).toBe(true)
  })

  it('brands are distinct at the type level and plain strings at runtime', () => {
    const space = spaceId('s')!
    const note = noteId('n')!
    const takesSpace = (id: SpaceId) => id
    expect(takesSpace(space)).toBe('s')
    // @ts-expect-error a NoteId is not a SpaceId
    takesSpace(note)
    expect(typeof space).toBe('string')
  })

  it('knows a ULID and a note path', () => {
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true)
    expect(isUlid('not a ulid')).toBe(false)
    expect(notePath('Notes/One.md')).toBe('Notes/One.md')
    expect(notePath('')).toBeNull()
    expect(notePath('a\0b')).toBeNull()
  })
})

describe('ask efforts', () => {
  it('names every effort a model is asked with, from none to the most, and nothing else', () => {
    expect(ASK_EFFORTS[0]).toBe('none')
    expect(ASK_EFFORTS.at(-1)).toBe('max')
    expect(ASK_EFFORTS.every(isAskEffort)).toBe(true)
    expect(isAskEffort('auto')).toBe(false)
    expect(isAskEffort(3)).toBe(false)
  })
})

describe('results', () => {
  it('never throws: a failure is a value with its module and kind', () => {
    const failed = attempt('contracts', () => {
      throw new Error('boom')
    })
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.error).toMatchObject({ kind: 'failed', message: 'boom', module: 'contracts' })
      expect(failed.error.cause).toBeInstanceOf(Error)
    }
    expect(attempt('contracts', () => 3)).toEqual(ok(3))
  })

  it('maps and unwraps', () => {
    const one: Result<number> = ok(2)
    expect(mapResult(one, (n) => n * 2)).toEqual(ok(4))
    const bad: Result<number> = err(failure('contracts', 'missing', 'gone'))
    expect(mapResult(bad, (n) => n * 2)).toBe(bad)
    expect(unwrapOr(bad, 7)).toBe(7)
    expect(isOk(one)).toBe(true)
    expect(isOk(bad)).toBe(false)
  })

  it('leaves out status and cause when not given', () => {
    expect(failure('contracts', 'invalid', 'no')).toEqual({
      kind: 'invalid',
      message: 'no',
      module: 'contracts',
    })
    expect(failure('contracts', 'refused', 'no', { status: 403 }).status).toBe(403)
  })

  it('catches an async rejection the same way', async () => {
    const failed = await attemptAsync(
      'contracts',
      () => Promise.reject(new Error('late')),
      'timeout',
    )
    expect(failed).toMatchObject({ ok: false, error: { kind: 'timeout', message: 'late' } })
    expect(await attemptAsync('contracts', () => Promise.resolve('fine'))).toEqual(ok('fine'))
  })
})

describe('shared objects', () => {
  it('lists the entry kinds the sync wire carries', () => {
    expect(ENTRY_KINDS).toEqual([
      'note',
      'canvas',
      'pages',
      'url',
      'term',
      'chat',
      'file',
      'folder',
    ])
    expect(isEntryKind('url')).toBe(true)
    expect(isEntryKind('settings')).toBe(false)
  })

  it('normalises line endings as the workspace does', () => {
    expect(unixLines('a\r\nb\rc\n')).toBe('a\nb\nc\n')
    const plain = 'a\nb'
    expect(unixLines(plain)).toBe(plain)
  })

  it('knows roles and schemes', () => {
    expect(isSpaceRole('owner')).toBe(true)
    expect(isSpaceRole('admin')).toBe(false)
    expect(isScheme('dark')).toBe(true)
    expect(isSchemeChoice('system')).toBe(true)
    expect(isScheme('system')).toBe(false)
  })
})

describe('shell extension points', () => {
  it('names every tab kind the workspace has', () => {
    expect([...TAB_KINDS].sort()).toEqual(
      [
        'application',
        'canvas',
        'channel',
        'chat',
        'explorer',
        'graph',
        'note',
        'pages',
        'pass',
        'pdf',
        'settings',
        'terminal',
        'time',
        'view',
        'web',
      ].sort(),
    )
    expect(isTabKind('note')).toBe(true)
    expect(isTabKind('folder')).toBe(false)
  })

  it('starts with no extensions', () => {
    expect(EMPTY_EXTENSIONS).toEqual({
      tabKinds: [],
      commands: [],
      settingsSections: [],
      sidebarPanels: [],
    })
  })

  it('only takes events under the app scheme', () => {
    expect(isEventName('orden://open-url')).toBe(true)
    expect(isEventName('orden://')).toBe(false)
    expect(isEventName('https://open-url')).toBe(false)
  })
})

describe('ports', () => {
  it('answers a missing port with a result, not a throw, and the bound one once provided', () => {
    expect(portProvided('sync.clock')).toBe(false)
    const missing = portOf('sync.clock')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.kind).toBe('missing')

    const heard: number[] = []
    whenPortProvided('sync.clock', (clock) => heard.push(clock.now()))
    expect(heard).toEqual([])
    const unbind = providePort('sync.clock', { now: () => 7, waited: () => Promise.resolve() })
    expect(heard).toEqual([7])
    whenPortProvided('sync.clock', (clock) => heard.push(clock.now() + 1))
    expect(heard).toEqual([7, 8])
    expect(
      unwrapOr(
        mapResult(portOf('sync.clock'), (clock) => clock.now()),
        0,
      ),
    ).toBe(7)

    unbind()
    expect(portProvided('sync.clock')).toBe(false)
  })

  it('lets a later binding replace an earlier one, and an old unbind leave the new one alone', () => {
    const first = providePort('sync.clock', { now: () => 1, waited: () => Promise.resolve() })
    const second = providePort('sync.clock', { now: () => 2, waited: () => Promise.resolve() })
    first()
    expect(
      unwrapOr(
        mapResult(portOf('sync.clock'), (clock) => clock.now()),
        0,
      ),
    ).toBe(2)
    second()
    expect(portProvided('sync.clock')).toBe(false)
  })

  it('answers the web pages with blank ones and nothing held until the web tab binds them', async () => {
    const none = webPages()
    expect(none.cuts).toBe(false)
    expect(none.of('t')).toEqual({
      url: null,
      title: '',
      back: false,
      forward: false,
      zoom: 1,
      shot: null,
    })
    expect(none.holdStill()).toBeNull()
    await expect(none.letGo()).resolves.toBeUndefined()

    const page = {
      url: 'https://a.example/',
      title: 'A',
      back: true,
      forward: false,
      zoom: 2,
      shot: null,
    }
    const unbind = providePort('web.pages', { ...none, cuts: true, of: () => page })
    expect(webPages().cuts).toBe(true)
    expect(webPages().of('t')).toBe(page)
    unbind()
    expect(webPages().of('t').url).toBeNull()
  })
})
