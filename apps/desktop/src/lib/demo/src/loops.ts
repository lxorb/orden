import { type ChatsDemo, portOf } from '@orden/contracts'
import { setPeers } from '@orden/editor'
import type { DemoCue } from '../../showcase/src/api'
import { CanvasStore } from '../../canvas/src/api'
import { samePath } from '../../platform/src/api'
import { addTask, tickTask, todos } from '../../tasks-model/src/api'
import { overlays } from '../../ui-kit/src/api'
import { agentMarks, paletteWords, tabOverview, toggleTabOverview, type Tab, workspace } from '../../workspace/src/api'
import { chatStore } from '../../ai-chat/src/api'
import { ai } from '../../ai-providers/src/api'
import { replacement, TEAM, writtenAt } from './scenes'
import { browsing, scriptOf, turnsAt, working } from './ai'
import { BEFORE, CHAT_NAME, chatAt, DURING, PEOPLE } from './chat'
import { inkAt } from './ink'
import type { Stage } from './run'
import { LAUNCH, PAGE, PLAN_TEXT, RIDE_DATA, RIDE_TEXT, RIDE_WRITTEN, ROOT, ROUTES, SPEC, WRITTEN } from './space'

type Draw = (cue: Pick<DemoCue, 'scene' | 'at' | 'still'>, now: number) => void
export interface LoopScene {
  period: number
  still: number
  ready?: () => Promise<void>
  tick: (phase: number, now: number) => void
}
const clamp = (value: number) => Math.min(1, Math.max(0, value))
const smooth = (value: number) => value * value * (3 - 2 * value)
const there = (phase: number, rest = 0.2): number => smooth(clamp((0.5 - Math.abs(phase - 0.5)) / (0.5 - rest)))
const within = (phase: number, from: number, to: number): boolean => phase >= from && phase < to
const scheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
const until = async <T>(found: () => T | null | undefined): Promise<T> => {
  for (;;) {
    const one = found()
    if (one) return one
    await new Promise((done) => setTimeout(done, 30))
  }
}
async function opened(path: string): Promise<Tab> {
  await workspace.open(path)
  return until(() => workspace.tabs.find((one) => samePath(one.path, path)))
}
function writer(
  tab: () => Tab | null,
  text: string,
  written: readonly { after: string; words: string; lead?: string }[],
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
        carets.map((head, index) => ({
          id: index + 1,
          name: TEAM[index]?.name ?? '',
          colour: TEAM[index]?.[scheme()] ?? '',
          head,
          anchor: head,
        })),
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
const QUERY = 'ride'
const KEPT_TODOS = [
  'Frame samples from the shop #launch',
  'Ride test with Mara #launch p2',
  'Photos of all three colours #press',
]
const NEW_TODO = 'Send the kit to three city blogs #press p1'
export function loopScenes(stage: Stage, draw: Draw): Record<string, LoopScene | undefined> & { canvas: LoopScene } {
  let ride: Tab | null = null
  const rideWriter = writer(() => ride, RIDE_TEXT, RIDE_WRITTEN)
  let tidied = false
  let shownQuery: string | null = null
  const searching = stepper(async (to) => {
    if (to === 0) {
      overlays.escape()
      shownQuery = null
    }
    await Promise.resolve()
  })
  let made: string | null = null
  const todoing = stepper(async (to) => {
    if (to === 1 && made === null) made = (await addTask(NEW_TODO))?.id ?? null
    if (to === 2 && made !== null) await tickTask(made, true)
    if (to === 0 && made !== null) {
      await todos.remove(made)
      made = null
    }
  })
  let spec: Tab | null = null
  let inked = ''
  let handsAt = -Infinity
  type Chat = Awaited<ReturnType<typeof chatStore>>['chat']
  let asking: Chat | null = null
  let told = ''
  let browsed = ''
  const script = scriptOf(location.origin + PAGE, location.origin + ROUTES)
  const planWriter = writer(() => stage.plan, PLAN_TEXT, WRITTEN)
  const FLOW = [0.12, 0.25, 0.45, 0.6, 0.75, 0.9]
  const flowStep = (phase: number) => {
    const at = FLOW.findIndex((one) => phase < one)
    return at === -1 ? 0 : at
  }
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
  let talk: { chats: ChatsDemo; path: string } | null = null
  let talked = { said: 0, typing: null as string | null }
  let staging = false
  let lastPhase = 0
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
      talked = { said: 0, typing: null }
    } finally {
      staging = false
    }
  }
  return {
    chat: {
      period: 16000,
      still: 0.85,
      ready: restage,
      tick: (phase) => {
        const wrapped = phase < lastPhase
        lastPhase = phase
        if (wrapped) {
          void restage()
          return
        }
        if (!talk) return
        const now = chatAt(phase)
        if (now.typing !== talked.typing) {
          if (talked.typing) talk.chats.typing(talk.path, talked.typing, false)
          if (now.typing) talk.chats.typing(talk.path, now.typing, true)
        }
        for (let at = talked.said; at < now.said; at++) {
          const line = DURING[at]
          if (line) talk.chats.say(talk.path, line.from, line.body)
        }
        talked = now
      },
    },
    flow: {
      period: 20000,
      still: 0.35,
      tick: (phase, now) => {
        const step = flowStep(phase)
        flowing(step)
        if (step === 0) draw({ scene: 'canvas', at: 1, still: false }, now)
        const typed = step === 2 ? clamp((phase - 0.27) / 0.16) : step >= 3 && step <= 5 ? 1 : 0
        planWriter(WRITTEN.map((one) => Math.round(one.words.length * typed)))
      },
    },
    ai: {
      period: 18000,
      still: 0.8,
      ready: async () => {
        const { chat } = await chatStore()
        if (!ai.providers.length) {
          const made = ai.add('compatible')
          ai.update(made.id, { baseUrl: 'https://ai.orden.so', model: 'assistant' })
        }
        if (stage.page) {
          workspace.activate(stage.page.id)
          await new Promise((done) => setTimeout(done, 200))
          document.querySelector<HTMLButtonElement>('.card .rows .orden-button:not(.is-quiet)')?.click()
        }
        workspace.showPanel('ask')
        await new Promise((done) => setTimeout(done, 300))
        chat.newThread()
        asking = chat
        const thread = chat.thread
        if (thread) thread.title = 'Weekend routes'
        if (document.documentElement.dataset.demo !== 'phone' || !thread) return
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
        const page = stage.page
        if (!page) return
        const worn = busy ? { [page.id]: { agent: 'Assistant', colour: TEAM[2][scheme()], stopped: false } } : {}
        if (JSON.stringify(agentMarks.on) !== JSON.stringify(worn)) agentMarks.on = worn
        const where = location.origin + (browsing(phase) === 'routes' ? ROUTES : PAGE)
        const frame = document.querySelector<HTMLIFrameElement>('iframe')
        if (frame && where !== browsed) {
          browsed = where
          frame.src = where
        }
      },
    },
    pages: {
      period: 15000,
      still: 0.8,
      ready: async () => {
        await workspace.openPdf(`${ROOT}/${SPEC}`)
        const tab = await until(() => workspace.tabs.find((one) => one.path?.endsWith('.pages')))
        await until(() => CanvasStore.drawing(tab.note, workspace.tabs))
        spec = tab
      },
      tick: (phase, now) => {
        if (!spec) return
        if (workspace.activeTabId !== spec.id) workspace.activate(spec.id)
        const store = CanvasStore.drawing(spec.note, workspace.tabs)
        const page = store?.canvas.nodes.find((one) => one.type === 'page')
        if (!store || !page) return
        const who = TEAM[2]
        const colour = who[scheme()]
        const { kept, live, tip } = inkAt(phase, page, colour)
        const key = kept.map((one) => one.id).join()
        if (key !== inked) {
          inked = key
          store.arrived({
            ...store.canvas,
            ink: [...store.canvas.ink.filter((one) => !one.id.startsWith('demo-')), ...kept],
          })
        }
        if (now - handsAt < 90) return
        handsAt = now
        const at = tip ?? { x: page.x + page.width * 0.78, y: page.y + page.height * 0.3 }
        store.handsAre([{ id: 3, name: who.name, colour, at, stroke: live }])
      },
    },
    canvas: {
      period: 16000,
      still: 0.5,
      tick: (phase, now) => draw({ scene: 'canvas', at: there(phase, 0.15), still: false }, now),
    },
    bubbles: {
      period: 14000,
      still: 0.5,
      tick: (phase, now) => {
        draw({ scene: 'overview', at: within(phase, 0.12, 0.86) ? 1 : 0, still: false }, now)
        if (phase < 0.4) tidied = false
        if (!tidied && within(phase, 0.45, 0.6)) {
          tidied = true
          const tidy = [...document.querySelectorAll('button')].find((one) => one.textContent.trim() === 'Tidy up')
          tidy?.click()
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
      },
    },
    search: {
      period: 12000,
      still: 0.6,
      tick: (phase) => {
        const open = within(phase, 0.1, 0.85)
        searching(open ? 1 : 0)
        if (!open) return
        const query = QUERY.slice(0, Math.round(QUERY.length * clamp((phase - 0.22) / 0.2)))
        if (query !== shownQuery) {
          shownQuery = query
          paletteWords.words = query
        }
      },
    },
    todos: {
      period: 15000,
      still: 0.6,
      ready: async () => {
        for (const one of KEPT_TODOS) await addTask(one)
        workspace.showPanel('tasks')
      },
      tick: (phase) => todoing(within(phase, 0.15, 0.85) ? (phase < 0.5 ? 1 : 2) : 0),
    },
    write: {
      period: 16000,
      still: 0.5,
      tick: (phase, now) => draw({ scene: 'write', at: 0.3 + 0.7 * there(phase, 0.15), still: false }, now),
    },
  }
}
