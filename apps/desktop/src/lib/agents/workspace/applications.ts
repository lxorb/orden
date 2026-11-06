import type { InputEvent } from '@orden/online/apps'
import type { AgentAnswer } from '../../automation/caller'
import { shownName } from '../../note-name'
import { nameOf } from '../../space-paths'
import type { Tab } from '../../workspace.svelte'
import { workspace } from '../../workspace.svelte'
import { asked } from './asks'
import { type Call, done, need } from './call'
import { Refused } from './problem'

const MOST_EVENTS = 200
const MOST_TEXT = 2000

const BUTTONS: Readonly<Record<string, number>> = { left: 0, middle: 1, right: 2 }

const MODIFIERS: Readonly<Record<string, { key: string; code: string }>> = {
  ctrl: { key: 'Control', code: 'ControlLeft' },
  control: { key: 'Control', code: 'ControlLeft' },
  shift: { key: 'Shift', code: 'ShiftLeft' },
  alt: { key: 'Alt', code: 'AltLeft' },
  meta: { key: 'Meta', code: 'MetaLeft' },
  super: { key: 'Meta', code: 'MetaLeft' },
  cmd: { key: 'Meta', code: 'MetaLeft' },
}

type Session = import('../../apps/session.svelte').AppSession

export async function applicationTabs(call: Call): Promise<AgentAnswer> {
  const op = need(call, 'op')
  const { appSessionIfAny } = await import('../../apps/session.svelte')
  if (op === 'list') {
    return done({
      applications: workspace.tabs
        .filter((tab) => tab.kind === 'application')
        .map((tab) => listed(tab, appSessionIfAny(tab))),
    })
  }

  const tab = applicationTab(call)
  const session = appSessionIfAny(tab)
  if (!session) {
    throw new Refused(
      'bad_arguments',
      `${named(tab)} is not connected yet: it connects once its tab has been shown`,
    )
  }
  held(tab, session)

  if (op === 'start' || op === 'stop' || op === 'restart') {
    const question = await asked(call, null, `${word(op)} ${named(tab)}`, siteOf(tab))
    if (question) return question
    session.run(op)
    return done({ tab: tab.id, [op === 'stop' ? 'stopping' : 'starting']: true })
  }
  if (op === 'picture') {
    const stream = session.picture.stream
    if (session.picture.status.is !== 'showing' || !stream) {
      throw new Refused('failed', `${named(tab)} shows no picture now: start it, then ask again`)
    }
    const { frameOf } = await import('../../apps/frame')
    const frame = await frameOf(stream)
    if (!frame) throw new Refused('timeout', `${named(tab)} gave no frame in time`)
    return done(frame, `the application ${named(tab)}`)
  }
  if (op === 'input') {
    const events = inputOf(call.args.events)
    if (session.picture.channel?.readyState !== 'open') {
      throw new Refused('failed', `${named(tab)} takes no input now: start it, then ask again`)
    }
    const question = await asked(call, null, `Use ${named(tab)}`, siteOf(tab))
    if (question) return question
    for (const one of events) session.picture.input(one)
    return done({ tab: tab.id, sent: events.length })
  }
  throw new Refused('bad_arguments', 'op is list, start, stop, restart, picture or input')
}

function applicationTab(call: Call): Tab {
  const id = need(call, 'tab')
  const tab = workspace.tabs.find((one) => one.id === id)
  if (!tab) throw new Refused('no_such_tab', `there is no tab ${id}: op list names them`)
  if (tab.kind !== 'application') {
    throw new Refused('bad_arguments', `tab ${id} is a ${tab.kind} tab, not an application`)
  }
  return tab
}

function held(tab: Tab, session: Session): void {
  if (session.holds) return
  const status = session.status
  if (status.is === 'held') {
    throw new Refused(
      'by_hand',
      `${status.holder.by || 'another device'} holds ${named(tab)}: only the reader takes it over, in its tab`,
    )
  }
  throw new Refused('failed', `${named(tab)} is not held here (${status.is}): ask again shortly`)
}

function listed(tab: Tab, session: Session | null) {
  const status = session?.status ?? null
  return {
    tab: tab.id,
    name: named(tab),
    path: tab.path,
    host: session === null || session.hostName === '' ? null : session.hostName,
    status: status?.is ?? 'not_connected',
    ...(status?.is === 'here' ? { state: status.state, why: status.why } : {}),
    ...(status?.is === 'held' ? { held_by: status.holder.by || null } : {}),
    holds: session?.holds ?? false,
    picture: session?.picture.status.is ?? 'off',
  }
}

function named(tab: Tab): string {
  return tab.path ? shownName(nameOf(tab.path)) : tab.id
}

function siteOf(tab: Tab): string {
  return `application:${tab.path ?? tab.id}`
}

function word(op: 'start' | 'stop' | 'restart'): string {
  return op === 'start' ? 'Start' : op === 'stop' ? 'Stop' : 'Restart'
}

export function inputOf(said: unknown): InputEvent[] {
  if (!Array.isArray(said) || said.length === 0) {
    throw new Refused('bad_arguments', 'say events, a list of what to do')
  }
  if (said.length > MOST_EVENTS) {
    throw new Refused('bad_arguments', `at most ${MOST_EVENTS} events a call`)
  }
  return said.flatMap((one: unknown, at) => eventsOf(one, at))
}

function eventsOf(one: unknown, at: number): InputEvent[] {
  const event = typeof one === 'object' && one !== null ? (one as Record<string, unknown>) : {}
  const bad = (why: string) => new Refused('bad_arguments', `event ${at}: ${why}`)
  const point = (): { x: number; y: number } => {
    const { x, y } = event
    if (typeof x !== 'number' || typeof y !== 'number' || !(x >= 0) || !(y >= 0)) {
      throw bad('x and y are the picture’s pixels, from its top left')
    }
    return { x: Math.round(x), y: Math.round(y) }
  }
  const button = (): number => {
    const named = event.button ?? 'left'
    const found = typeof named === 'string' ? BUTTONS[named] : undefined
    if (found === undefined) throw bad('button is left, middle or right')
    return found
  }
  const moved = (): InputEvent[] =>
    event.x === undefined && event.y === undefined ? [] : [{ t: 'move', ...point() }]

  switch (event.type) {
    case 'move':
      return [{ t: 'move', ...point() }]
    case 'click': {
      const which = button()
      const times = typeof event.count === 'number' ? Math.min(Math.max(event.count, 1), 3) : 1
      const clicks = Array.from({ length: Math.round(times) }, (): InputEvent[] => [
        { t: 'button', button: which, down: true },
        { t: 'button', button: which, down: false },
      ]).flat()
      return [...moved(), ...clicks]
    }
    case 'down':
    case 'up':
      return [...moved(), { t: 'button', button: button(), down: event.type === 'down' }]
    case 'scroll': {
      const clicks = (name: string) => {
        const value = event[name] ?? 0
        if (typeof value !== 'number' || !Number.isFinite(value)) throw bad(`${name} is a number`)
        return Math.max(-50, Math.min(50, Math.trunc(value)))
      }
      return [...moved(), { t: 'wheel', x: clicks('dx'), y: clicks('dy') }]
    }
    case 'key':
      return chord(event.key, bad)
    case 'text': {
      const text = event.text
      if (typeof text !== 'string' || text === '') throw bad('say text')
      if (text.length > MOST_TEXT) throw bad(`at most ${MOST_TEXT} characters of text`)
      return [{ t: 'text', text }]
    }
    default:
      throw bad('type is move, click, down, up, scroll, key or text')
  }
}

function chord(said: unknown, bad: (why: string) => Refused): InputEvent[] {
  if (typeof said !== 'string' || said.trim() === '') throw bad('say key, such as Enter or Ctrl+S')
  const parts = said.split('+').map((one) => one.trim())
  const last = parts.pop() ?? ''
  const held = parts.map((one) => {
    const found = MODIFIERS[one.toLowerCase()]
    if (!found) throw bad(`${one} is not Ctrl, Shift, Alt or Meta`)
    return found
  })
  if (last === '') throw bad('say the key after the modifiers')
  const shifted = held.some((one) => one.key === 'Shift')
  const key = last.length === 1 && !shifted ? last.toLowerCase() : last
  const code = `Agent:${key}`
  return [
    ...held.map((one): InputEvent => ({ t: 'key', key: one.key, code: one.code, down: true })),
    { t: 'key', key, code, down: true },
    { t: 'key', key, code, down: false },
    ...held
      .reverse()
      .map((one): InputEvent => ({ t: 'key', key: one.key, code: one.code, down: false })),
  ]
}
