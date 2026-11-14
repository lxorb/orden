import { describe, expect, it } from 'vitest'
import {
  ASK_EFFORTS,
  commandRows,
  commandRowsLoaded,
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
  NO_TAB_KIND,
  NO_VISITS,
  paletteKind,
  registered,
  registerFeature,
  registerPaletteKind,
  registerSettingFields,
  registerSettingsPart,
  registerCommand,
  registerCommandRows,
  registerCommands,
  registerTabKind,
  settingFieldsIn,
  settingsPartsIn,
  mayStop,
  notePath,
  ok,
  portOf,
  portProvided,
  providePort,
  runCommand,
  spaceId,
  STOPPING_KINDS,
  TAB_KINDS,
  tabKindLoaded,
  tabKindParts,
  unixLines,
  unwrapOr,
  userId,
  webPages,
  whenLoaded,
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

  it('asks a port for each kind of thing quitting would stop', async () => {
    expect([...STOPPING_KINDS]).toEqual(['terminal', 'thread'])
    const row = { window: 'main', kind: 'thread', id: 'a', name: 'A', busy: true } as const
    const unbind = providePort('quit.thread', {
      rows: () => Promise.resolve([row]),
      show: () => Promise.resolve(),
    })
    const port = portOf('quit.thread')
    expect(port.ok && (await port.value.rows('main', false))).toEqual([row])
    expect(portProvided('quit.terminal')).toBe(false)
    unbind()
  })

  it('may stop when nothing asks, and otherwise as the asking port answers', async () => {
    expect(await mayStop('restart')).toBe(true)
    const asked: string[] = []
    const unbind = providePort('quit.ask', {
      mayStop: (why) => {
        asked.push(why)
        return Promise.resolve(false)
      },
    })
    expect(await mayStop('restart')).toBe(false)
    expect(asked).toEqual(['restart'])
    unbind()
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
      loading: false,
      icon: null,
      live: false,
      shown: false,
    })
    expect(none.tabs()).toEqual([])
    expect(none.lentOf('t')).toBe(false)
    await expect(none.losing('t')).resolves.toBe(false)
    await expect(none.reload('t')).resolves.toBeUndefined()
    await expect(none.park('t', true)).resolves.toBeUndefined()
    none.copyPage('t', 'u', null, false)
    expect(none.of('u').title).toBe('')
    expect(none.addressOf('t')).toBeNull()
    expect(none.faviconOf('https://a.example/')).toBeNull()
    expect(none.holdStill()).toBeNull()
    await expect(none.clip('t', true)).resolves.toBeNull()
    await expect(none.letGo()).resolves.toBeUndefined()
    await expect(none.bringHistory([{ url: 'https://a.example/' }])).resolves.toBeUndefined()
    await expect(none.takeEngine({ id: 'bing' })).resolves.toBe('same')

    const page = {
      url: 'https://a.example/',
      title: 'A',
      back: true,
      forward: false,
      zoom: 2,
      shot: null,
      loading: false,
      icon: null,
      live: true,
      shown: true,
    }
    const unbind = providePort('web.pages', { ...none, cuts: true, of: () => page })
    expect(webPages().cuts).toBe(true)
    expect(webPages().of('t')).toBe(page)
    unbind()
    expect(webPages().of('t').url).toBeNull()
  })
})

describe('registry', () => {
  it('reads a palette kind once it is registered and loaded, and nothing before', async () => {
    expect(paletteKind('visits')).toBe(NO_VISITS)
    const seen = [{ url: 'https://a.example/', title: 'A', visits: 1, typed: 0, last: 0 }]
    const visits = { ...NO_VISITS, list: () => seen }
    const unregister = registerPaletteKind('visits', () => Promise.resolve(visits))
    expect(paletteKind('visits')).toBe(NO_VISITS)
    await registered()
    expect(paletteKind('visits').list()).toEqual(seen)
    unregister()
    expect(paletteKind('visits')).toBe(NO_VISITS)
  })

  it('reads setting fields by section and group once loaded, and skips a load that fails', async () => {
    let on = false
    const unregister = registerSettingFields({
      section: 'general',
      group: 'Browser',
      load: () =>
        Promise.resolve(() => [
          {
            kind: 'switch' as const,
            label: 'A',
            hint: 'a',
            get: () => on,
            set: (to: boolean) => (on = to),
          },
        ]),
    })
    const broken = registerSettingFields({
      section: 'general',
      group: 'Browser',
      load: () => Promise.reject(new Error('gone')),
    })
    expect(settingFieldsIn('general', 'Browser')).toEqual([])
    await registered()
    const [field] = settingFieldsIn('general', 'Browser')
    expect(settingFieldsIn('general', 'Other')).toEqual([])
    if (field?.kind === 'switch') field.set(true)
    expect(on).toBe(true)
    unregister()
    broken()
    expect(settingFieldsIn('general', 'Browser')).toEqual([])
  })

  it('lists the settings parts of a section', () => {
    const part = {
      section: 'general' as const,
      title: 'Part',
      card: true,
      shown: () => true,
      load: () => Promise.resolve({ show: () => () => undefined }),
    }
    const unregister = registerSettingsPart(part)
    expect(settingsPartsIn('general')).toEqual([part])
    expect(settingsPartsIn('sync')).toEqual([])
    unregister()
    expect(settingsPartsIn('general')).toEqual([])
  })

  it('loads the registered features before what they register, once, and again after a failed load', async () => {
    let tries = 0
    let fails = true
    const unfeature = registerFeature(() => {
      tries += 1
      if (fails) return Promise.reject(new Error('offline'))
      registerSettingsPart({
        section: 'import',
        card: true,
        shown: () => true,
        places: () => [{ label: 'Bring in', text: ['Notion'] }],
        load: () => Promise.resolve({ show: () => () => undefined }),
      })
      return Promise.resolve()
    })
    await registered()
    expect(settingsPartsIn('import')).toEqual([])
    fails = false
    await registered()
    await registered()
    expect(tries).toBe(2)
    expect(settingsPartsIn('import').flatMap((one) => one.places?.() ?? [])).toEqual([
      { label: 'Bring in', text: ['Notion'] },
    ])
    unfeature()
  })

  it('reads a tab kind once loaded, nothing for a kind no feature registered, and skips a load that fails', async () => {
    expect(tabKindParts('terminal')).toBe(NO_TAB_KIND)
    expect(await tabKindLoaded('terminal')).toBe(NO_TAB_KIND)
    let loads = 0
    const parts = { menu: () => [{ label: 'Open another', run: () => undefined }, null] }
    const unregister = registerTabKind('terminal', () => {
      loads += 1
      return Promise.resolve(parts)
    })
    expect(tabKindParts('terminal')).toBe(NO_TAB_KIND)
    expect(await tabKindLoaded('terminal')).toBe(parts)
    expect(await tabKindLoaded('terminal')).toBe(parts)
    expect(loads).toBe(1)
    expect(tabKindParts('terminal').menu?.('t')[0]?.label).toBe('Open another')
    const broken = registerTabKind('application', () => Promise.reject(new Error('gone')))
    expect(await tabKindLoaded('application')).toBe(NO_TAB_KIND)
    unregister()
    broken()
    expect(tabKindParts('terminal')).toBe(NO_TAB_KIND)
  })
})

describe('loads', () => {
  function gate<T>() {
    let open: (value: T) => void = () => undefined
    let shut: (error: unknown) => void = () => undefined
    const loading = new Promise<T>((resolve, reject) => {
      open = resolve
      shut = reject
    })
    return { loading, open, shut }
  }

  it('hand what loaded to its use', async () => {
    const seen: string[] = []
    const { loading, open } = gate<string>()
    whenLoaded(
      () => loading,
      (one) => seen.push(one),
    )
    open('in')
    await loading
    expect(seen).toEqual(['in'])
  })

  it('use nothing once called off before they are in', async () => {
    const seen: string[] = []
    const { loading, open } = gate<string>()
    const off = whenLoaded(
      () => loading,
      (one) => seen.push(one),
    )
    off()
    open('late')
    await loading
    expect(seen).toEqual([])
  })

  it('tell a failed load to whoever still wants it', async () => {
    const missed: unknown[] = []
    const wanted = gate<string>()
    const unwanted = gate<string>()
    whenLoaded(
      () => wanted.loading,
      () => undefined,
      (error) => missed.push(error),
    )
    whenLoaded(
      () => unwanted.loading,
      () => undefined,
      (error) => missed.push(error),
    )()
    wanted.shut(new Error('gone'))
    unwanted.shut(new Error('unwanted'))
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    expect(missed.map((one) => (one as Error).message)).toEqual(['gone'])
  })

  it('runs a registered command once it loads, and answers false for one nobody registered or whose load fails', async () => {
    const ran: string[] = []
    expect(await runCommand('time.start')).toBe(false)
    const unregister = registerCommand('time.start', () =>
      Promise.resolve(() => void ran.push('started')),
    )
    const broken = registerCommand('time.stop', () => Promise.reject(new Error('offline')))
    expect(await runCommand('time.start')).toBe(true)
    expect(await runCommand('time.stop')).toBe(false)
    expect(ran).toEqual(['started'])
    unregister()
    broken()
    expect(await runCommand('time.start')).toBe(false)
  })

  it('runs a command of a registered namespace from the runs it loads, an exact one first', async () => {
    const ran: string[] = []
    const space = registerCommands('pass.', () =>
      Promise.resolve({ 'pass.open': () => void ran.push('open') }),
    )
    const exact = registerCommand('pass.lock', () => Promise.resolve(() => void ran.push('lock')))
    expect(await runCommand('pass.open')).toBe(true)
    expect(await runCommand('pass.lock')).toBe(true)
    expect(await runCommand('pass.generate')).toBe(false)
    expect(await runCommand('passage')).toBe(false)
    expect(ran).toEqual(['open', 'lock'])
    space()
    exact()
    expect(await runCommand('pass.open')).toBe(false)
  })

  it('reads command rows of a place once loaded, with the view handed in, and none for a failed load', async () => {
    const view = { line: 3 }
    const rows = registerCommandRows('web', () =>
      Promise.resolve((seen) => [
        { id: seen === view ? 'web-seen' : 'web-blind', label: 'Web', run: () => undefined },
      ]),
    )
    const broken = registerCommandRows('send', () => Promise.reject(new Error('offline')))
    expect(commandRows('web', view)).toEqual([])
    await commandRowsLoaded()
    expect(commandRows('web', view).map((one) => one.id)).toEqual(['web-seen'])
    expect(commandRows('send')).toEqual([])
    rows()
    broken()
    expect(commandRows('web', view)).toEqual([])
  })
})
