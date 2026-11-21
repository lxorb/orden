import { type ChatsDemo, portOf } from '@orden/contracts'
import { setPeers } from '@orden/editor'
import type { DemoCue } from '../../showcase/src/api'
import { CanvasStore } from '../../canvas/src/api'
import { samePath } from '../../platform/src/api'
import { addTask, tickTask, todos } from '../../tasks-model/src/api'
import { overlays } from '../../ui-kit/src/api'
import {
  agentMarks,
  paletteWords,
  spaceMoving,
  tabOverview,
  toggleTabOverview,
  type Tab,
  workspace,
} from '../../workspace/src/api'
import { chatStore } from '../../ai-chat/src/api'
import { ai } from '../../ai-providers/src/api'
import { frameAt, replacement, TEAM, writtenAt } from './scenes'
import { browsing, scriptOf, turnsAt, working } from './ai'
import { BEFORE, CHAT_NAME, chatAt, duringOf, PEOPLE } from './chat'
import { inkAt, nextTip } from './ink'
import { boxOf, onPlane, placeAt, type Point, Pointer, type Stop } from './pointer'
import type { Stage } from './run'
import {
  BASE,
  LAUNCH,
  PAGE,
  PAGE_TITLE,
  PLAN_TEXT,
  RIDE_DATA,
  RIDE_TEXT,
  RIDE_WRITTEN,
  ROOT,
  ROUTES,
  SPEC,
  WRITTEN,
} from './space'

type Draw = (cue: Pick<DemoCue, 'scene' | 'at' | 'still'> & { you?: boolean }, now: number) => void
export interface LoopScene {
  period: number
  still: number
  ready?: () => Promise<void>
  tick: (phase: number, now: number) => void
}
const clamp = (value: number) => Math.min(1, Math.max(0, value))
const smooth = (value: number) => value * value * (3 - 2 * value)
const there = (phase: number, rest = 0.2): number => smooth(clamp((0.5 - Math.abs(phase - 0.5)) / (0.5 - rest)))
const scheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
const phone = () => document.documentElement.dataset.demo === 'phone'
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))
const until = async <T>(found: () => T | null | undefined): Promise<T> => {
  for (;;) {
    const one = found()
    if (one) return one
    await pause(30)
  }
}
async function opened(path: string): Promise<Tab> {
  await workspace.open(path)
  return until(() => workspace.tabs.find((one) => samePath(one.path, path)))
}
const rest = (): Point => ({ x: innerWidth * 0.74, y: innerHeight * 0.8 })
const tabButton = (tab: () => Tab | null) => () => {
  const one = tab()
  return one ? boxOf(`button.pick[data-tab="${one.id}"]`) : null
}
const nudged = (at: () => Point | null, dx: number, dy: number) => () => {
  const point = at()
  return point ? { x: point.x + dx, y: point.y + dy } : null
}
function rowOf(words: string, inside: string): Element | null {
  for (const one of document.querySelectorAll(inside)) if (one.textContent.includes(words)) return one
  return null
}
const lineEnd = (words: string) => () => {
  for (const one of document.querySelectorAll('.cm-line')) {
    if (one.textContent.trim() !== words) continue
    const box = one.getBoundingClientRect()
    return { x: box.left + Math.min(box.width, 40) + 6, y: box.top + box.height / 2 }
  }
  return null
}
function writer(
  tab: () => Tab | null,
  text: string,
  written: readonly { after: string; words: string; lead?: string }[],
  people: readonly (number | null)[] = [0, 1],
) {
  let said = ''
  return (typed: readonly number[]) => {
    const note = tab()?.note
    if (!note) return
    const key = typed.join()
    if (key === said) return
    said = key
    const { text: wanted, carets } = writtenAt(text, typed, written)
    const change = replacement(note.live.text.toString(), wanted)
    if (change) note.live.arrived([change])
    note.live.announce([
      setPeers.of(
        carets.flatMap((head, index) => {
          const who = people[index]
          if (who === null || who === undefined) return []
          return [
            {
              id: who + 1,
              name: TEAM[who]?.name ?? '',
              colour: TEAM[who]?.[scheme()] ?? '',
              head,
              anchor: head,
            },
          ]
        }),
      ),
    ])
  }
}
function stepper(go: (to: number) => Promise<void>) {
  let now = 0
  let wanted = 0
  let busy = false
  const run = async () => {
    busy = true
    try {
      while (now !== wanted) {
        const next = wanted
        await go(next)
        now = next
      }
    } finally {
      busy = false
    }
  }
  return (to: number) => {
    wanted = to
    if (!busy && now !== wanted) void run()
  }
}
const stepOf = (phase: number, edges: readonly number[]) => {
  const at = edges.findIndex((one) => phase < one)
  return at === -1 ? edges.length : at
}
const QUERY = 'ride'
const KEPT_TODOS = [
  'Frame samples from the shop #launch',
  'Ride test with Mara #launch p2',
  'Photos of all three colours #press',
]
const NEW_TODO = 'Send the kit to three city blogs'
export function loopScenes(stage: Stage, draw: Draw): Record<string, LoopScene | undefined> & { canvas: LoopScene } {
  let mine: Pointer | null = null
  const you = () => (mine ??= new Pointer(phone() ? 'touch' : 'user'))
  let theirs: Pointer | null = null
  const assistant = () => (theirs ??= new Pointer('ai', 'AI'))
  let pen: Pointer | null = null
  const drawer = () => (pen ??= new Pointer(phone() ? 'touch' : 'pen'))
  const follow = (phase: number, stops: readonly Stop[], who = you()) => {
    const { at, press } = placeAt(phase, stops)
    who.show(at, press)
  }
  const store = () => CanvasStore.drawing(stage.canvas.note, workspace.tabs)
  const onBoard = (point: Point) => {
    const held = store()
    return held ? onPlane('.canvas.orden-host', held.camera, point) : null
  }
  let ride: Tab | null = null
  const rideWriter = writer(() => ride, RIDE_TEXT, RIDE_WRITTEN, [null, 1])
  const searching = stepper(async (to) => {
    if (to === 1) return
    overlays.escape()
    shownQuery = null
    const tab = to === 2 ? ride : stage.canvas
    if (tab && workspace.activeTabId !== tab.id) workspace.activate(tab.id)
    await pause(0)
  })
  let shownQuery: string | null = null
  let made: string | null = null
  let typedTodo = ''
  const todoing = stepper(async (to) => {
    if (to === 1 && made === null) made = (await addTask(`${NEW_TODO} #press p1`))?.id ?? null
    if (to === 2 && made !== null) await tickTask(made, true)
    if (to === 0 && made !== null) {
      await todos.remove(made)
      made = null
    }
  })
  let spec: Tab | null = null
  let penAt: Point | null = null
  let inked = ''
  type Chat = Awaited<ReturnType<typeof chatStore>>['chat']
  let asking: Chat | null = null
  let told = ''
  let browsed = ''
  const script = scriptOf(location.origin + PAGE, location.origin + ROUTES)
  const planWriter = writer(() => stage.plan, PLAN_TEXT, WRITTEN)
  const FLOW = [0.12, 0.25, 0.45, 0.6, 0.75, 0.9]
  let side = false
  let right = false
  let palette = false
  const flowing = stepper(async (to) => {
    const wantSide = to >= 1 && to <= 5
    if (wantSide !== side) {
      side = wantSide
      if (side) workspace.showPanel('tree')
      else workspace.closePanel('left')
    }
    const tab = to >= 2 && to <= 5 ? stage.plan : stage.canvas
    if (workspace.activeTabId !== tab.id) workspace.activate(tab.id)
    if ((to === 3) !== palette) {
      palette = to === 3
      if (palette) paletteWords.words = QUERY
      else overlays.escape()
    }
    if ((to === 4) !== tabOverview.open) toggleTabOverview()
    if ((to === 5) !== right) {
      right = to === 5
      if (right) workspace.showPanel('ask')
      else workspace.closeRight()
    }
    await new Promise((done) => requestAnimationFrame(done))
  })
  let ghost: HTMLElement | null = null
  const spaceOf = (name: string) => workspace.spaces.find((one) => samePath(one.root, `/${name}`))
  const bubbling = stepper(async (to) => {
    const open = to >= 1 && to <= 3
    if (open !== tabOverview.open) toggleTabOverview()
    const target = spaceOf(to === 2 || to === 3 ? 'Harbor' : 'Kestrel')
    const moving = stage.page
    if (moving && target && workspace.spaceOfTab(moving) !== target.id)
      await (await spaceMoving()).moveToSpace([moving.id], target.id)
    if (to !== 1) {
      ghost?.remove()
      ghost = null
    }
    await pause(0)
  })
  let talk: { chats: ChatsDemo; path: string } | null = null
  let talked = { said: 0, typing: null as string | null, reacted: 0 }
  let staging = false
  let lastPhase = 0
  const during = duringOf(`${location.origin}${BASE}demo/lan.svg`)
  const restage = async () => {
    const port = portOf('chats.demo')
    if (!port.ok || staging) return
    staging = true
    try {
      const [me, ...others] = PEOPLE
      const chats = await port.value.stage(me)
      const path = chats.add(`${ROOT}/${LAUNCH}`, CHAT_NAME, others)
      for (const one of BEFORE) chats.say(path, one.from, one.body)
      chats.open(path)
      talk = { chats, path }
      talked = { said: 0, typing: null, reacted: 0 }
    } finally {
      staging = false
    }
  }
  return {
    chat: {
      period: 18000,
      still: 0.9,
      ready: restage,
      tick: (phase) => {
        const wrapped = phase < lastPhase
        lastPhase = phase
        follow(phase, [
          { at: 0, to: rest },
          { at: 0.6, to: () => boxOf('[contenteditable="true"], textarea') },
          { at: 0.63, to: () => boxOf('[contenteditable="true"], textarea'), press: true },
          { at: 0.7, to: () => boxOf('button[aria-label="Send"]') ?? nudged(rest, 0, 0)(), press: true },
          { at: 0.85, to: rest },
        ])
        if (wrapped) {
          void restage()
          return
        }
        if (!talk) return
        const now = chatAt(phase, during)
        if (now.typing !== talked.typing) {
          if (talked.typing) talk.chats.typing(talk.path, talked.typing, false)
          if (now.typing) talk.chats.typing(talk.path, now.typing, true)
        }
        for (let at = talked.said; at < now.said; at++) {
          const line = during[at]
          if (!line) continue
          talk.chats.say(talk.path, line.from, line.body)
        }
        talked = now
      },
    },
    flow: {
      period: 20000,
      still: 0.35,
      tick: (phase, now) => {
        const step = stepOf(phase, FLOW) % FLOW.length
        flowing(step)
        if (step === 0) draw({ scene: 'canvas', at: 1, still: false }, now)
        const typed = step === 2 ? clamp((phase - 0.27) / 0.16) : step >= 3 && step <= 5 ? 1 : 0
        planWriter(WRITTEN.map((one) => Math.round(one.words.length * typed)))
        follow(phase, [
          { at: 0, to: rest },
          { at: 0.11, to: () => boxOf('[data-side-toggle="left"]'), press: true },
          { at: 0.24, to: tabButton(() => stage.plan), press: true },
          { at: 0.3, to: lineEnd('- Final photos of the Kestrel One') },
          { at: 0.44, to: () => boxOf('button[aria-label="Search notes and commands"]'), press: true },
          { at: 0.59, to: () => boxOf('button.overview[aria-label="Tabs"]'), press: true },
          { at: 0.74, to: () => boxOf('[data-side-toggle="right"]'), press: true },
          { at: 0.89, to: tabButton(() => stage.canvas), press: true },
          { at: 0.97, to: rest },
        ])
      },
    },
    ai: {
      period: 20000,
      still: 0.8,
      ready: async () => {
        const { chat } = await chatStore()
        if (!ai.providers.length) {
          const added = ai.add('compatible')
          ai.update(added.id, { baseUrl: 'https://ai.orden.so', model: 'assistant' })
        }
        if (stage.page) {
          workspace.activate(stage.page.id)
          await pause(200)
          document.querySelector<HTMLButtonElement>('.card .rows .orden-button:not(.is-quiet)')?.click()
        }
        workspace.showPanel('ask')
        await pause(300)
        chat.newThread()
        asking = chat
        const thread = chat.thread
        if (thread) thread.title = 'Weekend routes'
        if (!phone() || !thread) return
        thread.turns = turnsAt(0.05, script)
        chat.touched(thread)
        workspace.openChat(thread.id, 'Weekend routes')
      },
      tick: (phase) => {
        const thread = asking?.thread
        if (!asking || !thread) return
        const turns = turnsAt(phase, script)
        const key = JSON.stringify(
          turns.map((one) => one.parts.map((part) => (part.kind === 'tool' ? part.state : part.kind))),
        )
        if (key !== told) {
          told = key
          thread.turns = turns
          asking.touched(thread)
        }
        const busy = working(phase)
        if (asking.running.length > 0 !== busy) asking.running = busy ? [thread.id] : []
        follow(phase, [
          { at: 0, to: rest },
          { at: 0.02, to: () => boxOf('.chat [contenteditable="true"], [contenteditable="true"]'), press: true },
          { at: 0.05, to: rest },
        ])
        const page = stage.page
        if (!page || phone()) return
        const worn = busy ? { [page.id]: { agent: 'Assistant', colour: TEAM[2][scheme()], stopped: false } } : {}
        if (JSON.stringify(agentMarks.on) !== JSON.stringify(worn)) agentMarks.on = worn
        const where = location.origin + (browsing(phase) === 'routes' ? ROUTES : PAGE)
        const frame = document.querySelector<HTMLIFrameElement>('iframe')
        if (frame && where !== browsed) {
          browsed = where
          frame.src = where
        }
        const inner = frame?.contentWindow
        const view = frame?.contentDocument
        const box = frame?.getBoundingClientRect()
        const inside =
          (selector: string, index = 0) =>
          () => {
            const found = view?.querySelectorAll(selector)[index]
            if (!found || !box) return null
            const at = found.getBoundingClientRect()
            return { x: box.left + at.left + at.width / 2, y: box.top + at.top + at.height / 2 }
          }
        const root = view?.documentElement ?? null
        if (inner && root) {
          const tall = Math.max(0, root.scrollHeight - inner.innerHeight)
          const down =
            browsing(phase) === 'routes'
              ? tall * smooth(clamp((phase - 0.36) / 0.08))
              : tall * smooth(clamp((phase - 0.16) / 0.1))
          if (Math.abs(inner.scrollY - down) > 1) inner.scrollTo(0, down)
        }
        follow(
          phase,
          [
            { at: 0, to: () => null },
            { at: 0.12, to: () => (box ? { x: box.left + box.width * 0.5, y: box.top + box.height * 0.3 } : null) },
            { at: 0.22, to: inside('a.go') },
            { at: 0.3, to: inside('a.go'), press: true },
            { at: 0.36, to: () => (box ? { x: box.left + box.width * 0.5, y: box.top + box.height * 0.4 } : null) },
            { at: 0.44, to: inside('section div', 0) },
            { at: 0.5, to: inside('section div', 1) },
            { at: 0.56, to: inside('section div', 2) },
            { at: 0.62, to: inside('section div', 2), press: true },
            { at: 0.74, to: () => (box ? { x: box.right - 40, y: box.top + box.height * 0.5 } : null) },
            { at: 0.9, to: () => null },
          ],
          assistant(),
        )
      },
    },
    pages: {
      period: 12000,
      still: 0.8,
      ready: async () => {
        await workspace.openPdf(`${ROOT}/${SPEC}`)
        const tab = await until(() => workspace.tabs.find((one) => one.path?.endsWith('.pages')))
        await until(() => CanvasStore.drawing(tab.note, workspace.tabs))
        spec = tab
      },
      tick: (phase) => {
        if (!spec) return
        if (workspace.activeTabId !== spec.id) workspace.activate(spec.id)
        const held = CanvasStore.drawing(spec.note, workspace.tabs)
        const page = held?.canvas.nodes.find((one) => one.type === 'page')
        if (!held || !page) return
        const { strokes, tip } = inkAt(phase, page, TEAM[2][scheme()])
        const key = strokes.map((one) => `${one.id}:${one.points.length}`).join()
        if (key !== inked) {
          inked = key
          held.arrived({
            ...held.canvas,
            ink: [...held.canvas.ink.filter((one) => !one.id.startsWith('demo-')), ...strokes],
          })
        }
        const wanted = tip ?? nextTip(phase, page)
        penAt =
          tip ??
          (penAt ? { x: penAt.x + (wanted.x - penAt.x) * 0.12, y: penAt.y + (wanted.y - penAt.y) * 0.12 } : wanted)
        drawer().show(onPlane('.pages', held.camera, penAt), 0)
      },
    },
    canvas: {
      period: 16000,
      still: 0.5,
      tick: (phase, now) => {
        const at = there(phase, 0.15)
        draw({ scene: 'canvas', at, still: false, you: true }, now)
        const grip = frameAt('canvas', at, location.origin, phone()).grip
        const press = Math.max(0, 1 - Math.abs(at - 0.12) / 0.03)
        you().show(onBoard(grip), press)
      },
    },
    bubbles: {
      period: 16000,
      still: 0.55,
      tick: (phase, now) => {
        const step = stepOf(phase, [0.12, 0.32, 0.5, 0.84]) % 4
        draw({ scene: 'overview', at: step >= 1 && step <= 3 ? 1 : 0, still: false }, now)
        bubbling(step)
        const plan = () => boxOf(`button.window[aria-label="${PAGE_TITLE}"]`)
        const harbor = () => nudged(() => boxOf('button.window[aria-label="Menu"]'), 0, 30)()
        follow(phase, [
          { at: 0, to: rest },
          { at: 0.1, to: () => boxOf('button.overview[aria-label="Tabs"]'), press: true },
          { at: 0.2, to: plan },
          { at: 0.3, to: plan, press: true },
          { at: 0.5, to: harbor, press: true },
          { at: 0.64, to: () => boxOf('button.overview[aria-label="Tabs"]') },
          { at: 0.82, to: () => boxOf('button.overview[aria-label="Tabs"]'), press: true },
          { at: 0.95, to: rest },
        ])
        if (step === 1 && phase >= 0.31 && stage.page) {
          const source = document.querySelector<HTMLElement>(`button.window[aria-label="${PAGE_TITLE}"]`)
          if (!ghost && source) {
            ghost = source.cloneNode(true) as HTMLElement
            const box = source.getBoundingClientRect()
            Object.assign(ghost.style, {
              position: 'fixed',
              left: '0',
              top: '0',
              width: `${box.width}px`,
              height: `${box.height}px`,
              margin: '0',
              zIndex: '2147483646',
              pointerEvents: 'none',
              opacity: '0.9',
              boxShadow: '0 12px 30px rgb(0 0 0 / 0.35)',
            })
            document.body.append(ghost)
          }
          const { at } = placeAt(phase, [
            { at: 0.3, to: plan },
            { at: 0.5, to: harbor },
          ])
          if (ghost && at) {
            const box = ghost.getBoundingClientRect()
            ghost.style.transform = `translate(${at.x - box.width / 2}px, ${at.y - box.height / 2}px) scale(0.92)`
          }
        }
      },
    },
    markdown: {
      period: 16000,
      still: 0.5,
      ready: async () => {
        ride = await opened(`${ROOT}/${RIDE_DATA}`)
      },
      tick: (phase) => {
        if (ride && workspace.activeTabId !== ride.id) workspace.activate(ride.id)
        const shown = there(phase, 0.15)
        rideWriter([
          Math.round(RIDE_WRITTEN[0].words.length * clamp(shown * 1.25 - 0.25)),
          Math.round(RIDE_WRITTEN[1].words.length * clamp(shown * 1.25)),
        ])
        follow(phase, [
          { at: 0, to: rest },
          { at: 0.12, to: lineEnd('$$'), press: true },
          { at: 0.2, to: nudged(lineEnd('$$'), 60, 70) },
          { at: 0.9, to: rest },
        ])
      },
    },
    search: {
      period: 12000,
      still: 0.6,
      ready: async () => {
        ride = await opened(`${ROOT}/${RIDE_DATA}`)
        workspace.activate(stage.canvas.id)
      },
      tick: (phase) => {
        const step = stepOf(phase, [0.12, 0.68, 0.87])
        searching(step === 3 ? 0 : step)
        if (step === 1) {
          const query = QUERY.slice(0, Math.round(QUERY.length * clamp((phase - 0.22) / 0.2)))
          if (query !== shownQuery) {
            shownQuery = query
            paletteWords.words = query
          }
        }
        follow(phase, [
          { at: 0, to: rest },
          { at: 0.1, to: () => boxOf('button[aria-label="Search notes and commands"]'), press: true },
          { at: 0.5, to: () => boxOf('[role="option"][aria-selected="true"]') },
          { at: 0.66, to: () => boxOf('[role="option"][aria-selected="true"]'), press: true },
          { at: 0.85, to: tabButton(() => stage.canvas), press: true },
          { at: 0.95, to: rest },
        ])
      },
    },
    todos: {
      period: 16000,
      still: 0.5,
      ready: async () => {
        for (const one of KEPT_TODOS) await addTask(one)
        workspace.showPanel('tasks')
      },
      tick: (phase) => {
        const step = stepOf(phase, [0.38, 0.62, 0.9])
        todoing(step === 3 ? 0 : step)
        const field = document.querySelector<HTMLInputElement>('input[aria-label="Add a todo"]')
        const typing = step === 0 ? NEW_TODO.slice(0, Math.round(NEW_TODO.length * clamp((phase - 0.18) / 0.16))) : ''
        if (field && typing !== typedTodo) {
          typedTodo = typing
          field.value = typing
          field.dispatchEvent(new Event('input', { bubbles: true }))
        }
        const tick = () => {
          const row = rowOf(NEW_TODO, '.todo')
          const box = row?.querySelector('input.tick')?.getBoundingClientRect()
          return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null
        }
        follow(phase, [
          { at: 0, to: rest },
          { at: 0.14, to: () => boxOf('input[aria-label="Add a todo"]'), press: true },
          { at: 0.36, to: nudged(() => boxOf('input[aria-label="Add a todo"]'), 60, 0), press: true },
          { at: 0.5, to: tick },
          { at: 0.6, to: tick, press: true },
          { at: 0.75, to: rest },
        ])
      },
    },
    write: {
      period: 16000,
      still: 0.5,
      tick: (phase, now) => draw({ scene: 'write', at: 0.3 + 0.7 * there(phase, 0.15), still: false }, now),
    },
  }
}
