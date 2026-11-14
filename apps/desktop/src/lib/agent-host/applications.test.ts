import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { InputEvent } from '@orden/online/apps'
import { callerOf } from '../automation/caller'

interface FakeSession {
  holds: boolean
  status: Record<string, unknown>
  hostName: string
  picture: {
    status: { is: string }
    stream: object | null
    channel: { readyState: string } | null
    input: (event: InputEvent) => void
  }
  run: (what: string) => void
  take: () => void
}

const tabs = [
  { id: 'a1', kind: 'application', path: '/s/Work/GIMP.application' },
  { id: 'n1', kind: 'note', path: '/s/Work/Plan.md' },
  { id: 'a2', kind: 'application', path: '/s/Work/Blender.application' },
]
vi.mock('../workspace.svelte', () => ({
  workspace: {
    get tabs() {
      return tabs
    },
  },
}))

const sessions = new Map<string, FakeSession>()
const frames = vi.hoisted((): { next: unknown } => ({ next: null }))
vi.mock('../apps/src/api', () => ({
  appSessionIfAny: (tab: { id: string }) => sessions.get(tab.id) ?? null,
  frameOf: () => Promise.resolve(frames.next),
}))

const asked: { command: string; args: Record<string, unknown> }[] = []
let answer: Record<string, unknown> = { status: 'ok', result: {} }
vi.mock('../platform/src/tauri', () => ({
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    asked.push({ command, args })
    return Promise.resolve(answer)
  },
}))

const { applicationTabs, inputOf } = await import('./applications')

function session(change: Partial<FakeSession> = {}): FakeSession & {
  sent: InputEvent[]
  ran: string[]
  taken: number
} {
  const sent: InputEvent[] = []
  const ran: string[] = []
  const made = {
    holds: true,
    status: { is: 'here', state: 'running', code: null, why: null },
    hostName: 'Desk',
    picture: {
      status: { is: 'showing' },
      stream: {},
      channel: { readyState: 'open' },
      input: (event: InputEvent) => sent.push(event),
    },
    run: (what: string) => ran.push(what),
    take: () => {
      made.taken += 1
    },
    sent,
    ran,
    taken: 0,
    ...change,
  }
  return made
}

function call(args: Record<string, unknown>, mode = 'unsupervised') {
  return applicationTabs({
    verb: 'application_tabs',
    args,
    caller: callerOf({ id: 'claude', name: 'Claude', scopes: ['applications'], mode }),
  }).catch((error: unknown) => error)
}

beforeEach(() => {
  sessions.clear()
  asked.length = 0
  answer = { status: 'ok', result: {} }
  frames.next = { png: 'iVBOR', width: 800, height: 600 }
})

describe('the applications', () => {
  test('are listed with where each runs and whether this device holds it', async () => {
    sessions.set('a1', session())
    sessions.set(
      'a2',
      session({ holds: false, status: { is: 'held', holder: { by: 'Laptop', since: 1 } } }),
    )
    expect(await call({ op: 'list' })).toMatchObject({
      result: {
        applications: [
          { tab: 'a1', name: 'GIMP', host: 'Desk', status: 'here', state: 'running', holds: true },
          { tab: 'a2', name: 'Blender', status: 'held', held_by: 'Laptop', holds: false },
        ],
      },
    })
  })

  test('are started, stopped and restarted on their host while held here', async () => {
    const gimp = session()
    sessions.set('a1', gimp)
    for (const op of ['start', 'stop', 'restart']) {
      expect(await call({ op, tab: 'a1' })).toMatchObject({ status: 'ok' })
    }
    expect(gimp.ran).toEqual(['start', 'stop', 'restart'])
    expect(asked).toEqual([])
  })

  test('are seen as the frame the tab receives, marked as the application’s', async () => {
    sessions.set('a1', session())
    expect(await call({ op: 'picture', tab: 'a1' })).toMatchObject({
      status: 'ok',
      result: { png: 'iVBOR', width: 800, height: 600 },
      untrusted: 'the application GIMP',
    })
  })

  test('are used through the picture’s own channel', async () => {
    const gimp = session()
    sessions.set('a1', gimp)
    expect(
      await call({
        op: 'input',
        tab: 'a1',
        events: [
          { type: 'click', x: 10.4, y: 20 },
          { type: 'text', text: 'hello' },
        ],
      }),
    ).toMatchObject({ result: { sent: 4 } })
    expect(gimp.sent).toEqual([
      { t: 'move', x: 10, y: 20 },
      { t: 'button', button: 0, down: true },
      { t: 'button', button: 0, down: false },
      { t: 'text', text: 'hello' },
    ])
  })
})

describe('the lock', () => {
  test('held by another device, nothing goes and nothing is taken over', async () => {
    const elsewhere = session({
      holds: false,
      status: { is: 'held', holder: { by: 'Laptop', since: 1, taken: false } },
    })
    sessions.set('a1', elsewhere)
    for (const args of [
      { op: 'start', tab: 'a1' },
      { op: 'stop', tab: 'a1' },
      { op: 'picture', tab: 'a1' },
      { op: 'input', tab: 'a1', events: [{ type: 'key', key: 'Enter' }] },
    ]) {
      expect(await call(args), args.op).toMatchObject({
        code: 'by_hand',
        message: 'Laptop holds GIMP: only the reader takes it over, in its tab',
      })
    }
    expect(elsewhere.ran).toEqual([])
    expect(elsewhere.sent).toEqual([])
    expect(elsewhere.taken).toBe(0)
  })

  test('not held yet - connecting, the host away - nothing goes either', async () => {
    const away = session({ holds: false, status: { is: 'away' } })
    sessions.set('a1', away)
    expect(await call({ op: 'start', tab: 'a1' })).toMatchObject({ code: 'failed' })
    expect(away.ran).toEqual([])
    expect(away.taken).toBe(0)
  })

  test('a tab not connected yet, another kind of tab and no tab are refused', async () => {
    expect(await call({ op: 'start', tab: 'a1' })).toMatchObject({ code: 'bad_arguments' })
    expect(await call({ op: 'start', tab: 'n1' })).toMatchObject({ code: 'bad_arguments' })
    expect(await call({ op: 'start', tab: 'gone' })).toMatchObject({ code: 'no_such_tab' })
  })

  test('input waits for the picture’s channel, and a picture for the picture', async () => {
    sessions.set(
      'a1',
      session({
        picture: { status: { is: 'connecting' }, stream: null, channel: null, input: vi.fn() },
      }),
    )
    expect(await call({ op: 'picture', tab: 'a1' })).toMatchObject({ code: 'failed' })
    expect(
      await call({ op: 'input', tab: 'a1', events: [{ type: 'key', key: 'a' }] }),
    ).toMatchObject({ code: 'failed' })
  })
})

describe('asked as #1072 decided', () => {
  test('in confirm mode a start and any input ask first, with Always for that application', async () => {
    const gimp = session()
    sessions.set('a1', gimp)
    answer = { status: 'needs_approval', approval: 'q1', summary: 'Start GIMP' }
    expect(await call({ op: 'start', tab: 'a1' }, 'confirm')).toMatchObject({
      status: 'needs_approval',
    })
    expect(
      await call({ op: 'input', tab: 'a1', events: [{ type: 'key', key: 'Enter' }] }, 'confirm'),
    ).toMatchObject({ status: 'needs_approval' })
    expect(asked.map((one) => one.args)).toMatchObject([
      { category: 'writing', summary: 'Start GIMP', site: 'application:/s/Work/GIMP.application' },
      { category: 'writing', summary: 'Use GIMP', site: 'application:/s/Work/GIMP.application' },
    ])
    expect(gimp.ran).toEqual([])
    expect(gimp.sent).toEqual([])
  })

  test('under Full permissions nothing asks, and seeing it never asks', async () => {
    const gimp = session()
    sessions.set('a1', gimp)
    expect(await call({ op: 'restart', tab: 'a1' }, 'autonomous')).toMatchObject({ status: 'ok' })
    expect(await call({ op: 'picture', tab: 'a1' }, 'confirm')).toMatchObject({ status: 'ok' })
    expect(asked).toEqual([])
    expect(gimp.ran).toEqual(['restart'])
  })
})

describe('input, as the host plays it', () => {
  test('a chord presses its modifiers around the key, each let go of', () => {
    expect(inputOf([{ type: 'key', key: 'Ctrl+Shift+S' }])).toEqual([
      { t: 'key', key: 'Control', code: 'ControlLeft', down: true },
      { t: 'key', key: 'Shift', code: 'ShiftLeft', down: true },
      { t: 'key', key: 'S', code: 'Agent:S', down: true },
      { t: 'key', key: 'S', code: 'Agent:S', down: false },
      { t: 'key', key: 'Shift', code: 'ShiftLeft', down: false },
      { t: 'key', key: 'Control', code: 'ControlLeft', down: false },
    ])
    expect(inputOf([{ type: 'key', key: 'Ctrl+S' }])[1]).toEqual({
      t: 'key',
      key: 's',
      code: 'Agent:s',
      down: true,
    })
  })

  test('a key the host plays: named as people name it, the plus key too, and nothing it drops', () => {
    const pressed = (key: string) =>
      inputOf([{ type: 'key', key }])
        .filter((one) => one.t === 'key' && one.down)
        .map((one) => (one.t === 'key' ? one.key : ''))
    expect(pressed('Space')).toEqual([' '])
    expect(pressed('esc')).toEqual(['Escape'])
    expect(pressed('Return')).toEqual(['Enter'])
    expect(pressed('enter')).toEqual(['Enter'])
    expect(pressed('Shift+Up')).toEqual(['Shift', 'ArrowUp'])
    expect(pressed('Alt+f4')).toEqual(['Alt', 'F4'])
    expect(pressed('Ctrl++')).toEqual(['Control', '+'])
    expect(pressed('Ctrl + +')).toEqual(['Control', '+'])
    expect(pressed('+')).toEqual(['+'])
    expect(pressed('Ctrl+Plus')).toEqual(['Control', '+'])
    for (const key of ['Spaec', 'F25', 'Ctrl+Hyper', 'Ctrl+a+']) {
      expect(() => inputOf([{ type: 'key', key }]), key).toThrow()
    }
  })

  test('the wheel, a double click with the right button, a press held', () => {
    expect(
      inputOf([
        { type: 'scroll', x: 5, y: 6, dy: 3 },
        { type: 'click', button: 'right', count: 2 },
        { type: 'down', x: 1, y: 2 },
        { type: 'up' },
      ]),
    ).toEqual([
      { t: 'move', x: 5, y: 6 },
      { t: 'wheel', x: 0, y: 3 },
      { t: 'button', button: 2, down: true },
      { t: 'button', button: 2, down: false },
      { t: 'button', button: 2, down: true },
      { t: 'button', button: 2, down: false },
      { t: 'move', x: 1, y: 2 },
      { t: 'button', button: 0, down: true },
      { t: 'button', button: 0, down: false },
    ])
  })

  test('what does not say what to do is refused before anything is sent', () => {
    for (const [at, events] of [
      undefined,
      [],
      [{ type: 'click', x: -1, y: 2 }],
      [{ type: 'click', x: 1, y: 2, button: 'fourth' }],
      [{ type: 'key', key: 'Hyper+A' }],
      [{ type: 'key', key: 'Ctrl+' }],
      [{ type: 'text', text: '' }],
      [{ type: 'teleport' }],
      Array.from({ length: 201 }, () => ({ type: 'text', text: 'a' })),
    ].entries()) {
      expect(() => inputOf(events), `case ${at}`).toThrow()
    }
  })

  test('a point is a finite pixel, and a chord holds each modifier once, so one event never turns into thousands', () => {
    for (const [at, events] of [
      [{ type: 'move', x: Infinity, y: 2 }],
      [{ type: 'click', x: 1, y: Number.MAX_VALUE * 2 }],
      [{ type: 'key', key: `${'Ctrl+'.repeat(10_000)}a` }],
      [{ type: 'key', key: 'Shift+shift+A' }],
    ].entries()) {
      expect(() => inputOf(events), `case ${at}`).toThrow()
    }
    expect(inputOf([{ type: 'key', key: 'Ctrl+Alt+Shift+Meta+A' }])).toHaveLength(10)
  })
})
