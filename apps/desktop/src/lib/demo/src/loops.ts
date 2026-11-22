import type { DemoCue } from '../../showcase/src/api'
import { CanvasStore } from '../../canvas/src/api'
import { overlays } from '../../ui-kit/src/api'
import { agentMarks, paletteWords, type Tab, workspace } from '../../workspace/src/api'
import { chatStore } from '../../ai-chat/src/api'
import { ai } from '../../ai-providers/src/api'
import {
  clamp,
  type LoopScene,
  shown,
  nudged,
  opened,
  pause,
  phone,
  rest,
  scheme,
  smooth,
  stepOf,
  stepper,
  tabButton,
  until,
} from './kit'
import { todosScene } from './todos'
import { docScene } from './doc'
import { boardScene } from './board'
import { TEAM } from './scenes'
import { talkScene } from './talk'
import { flowScene } from './flow'
import { bubblesScene } from './bubbles'
import { browsing, scriptOf, turnsAt, working } from './ai'
import { inkAt, nextTip } from './ink'
import { boxOf, onPlane, type Point, Pointer, type Stop } from './pointer'
import { keysOf, typedAt } from './motion'
import type { Stage } from './run'
import { PAGE, RIDE_DATA, ROOT, ROUTES, INTERVIEWS, SPEC } from './space'

export type { LoopScene }
type Draw = (cue: Pick<DemoCue, 'scene' | 'at' | 'still'> & { you?: boolean }, now: number) => void
const ASK = 30000
const SEARCH = 23000
export function loopScenes(stage: Stage, draw: Draw): Record<string, LoopScene | undefined> & { canvas: LoopScene } {
  let mine: Pointer | null = null
  const you = () => (mine ??= new Pointer(phone() ? 'touch' : 'user'))
  let theirs: Pointer | null = null
  const assistant = () => (theirs ??= new Pointer('ai', 'AI'))
  let pen: Pointer | null = null
  const drawer = () => (pen ??= new Pointer(phone() ? 'touch' : 'pen'))
  const follow = (phase: number, period: number, stops: readonly Stop[], who = you()) =>
    shown(
      who,
      phase * period,
      stops.map((one) => ({ at: one.at * period, to: one.to, ...(one.press ? { press: true } : {}) })),
    )

  let ride: Tab | null = null
  let interviews: Tab | null = null
  const firstQuery = keysOf('ride', 61, 1.2, false)
  const secondQuery = keysOf('interviews', 62, 1.1)
  const searching = stepper(async (to) => {
    if (to === 1 || to === 3) return
    overlays.escape()
    shownQuery = null
    const tab = to === 2 ? ride : to === 4 ? interviews : stage.canvas
    if (tab && workspace.activeTabId !== tab.id) workspace.activate(tab.id)
    await pause(0)
  })
  let shownQuery: string | null = null
  let spec: Tab | null = null
  let penAt: Point | null = null
  let inked = ''
  type Chat = Awaited<ReturnType<typeof chatStore>>['chat']
  let asking: Chat | null = null
  let told = ''
  let browsed = ''
  const script = scriptOf(location.origin + PAGE, location.origin + ROUTES)
  return {
    ai: !__AI__
      ? undefined
      : {
          period: ASK,
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
              turns.map((one) =>
                one.parts.map((part) =>
                  part.kind === 'tool' ? part.state : part.kind === 'text' ? part.text.length : part.kind,
                ),
              ),
            )
            if (key !== told) {
              told = key
              thread.turns = turns
              asking.touched(thread)
            }
            const busy = working(phase)
            if (asking.running.length > 0 !== busy) asking.running = busy ? [thread.id] : []
            follow(phase, ASK, [
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
                  ? tall * (phase < 0.04 ? 1 : smooth(clamp((phase - 0.36) / 0.08)))
                  : tall * smooth(clamp((phase - 0.16) / 0.1))
              if (Math.abs(inner.scrollY - down) > 1) inner.scrollTo(0, down)
            }
            follow(
              phase,
              ASK,
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
      period: 22000,
      still: 0.8,
      ready: async () => {
        await workspace.openPdf(`${ROOT}/${SPEC}`)
        const tab = await until(() => workspace.tabs.find((one) => one.path?.endsWith('.pages')))
        await until(() => CanvasStore.drawing(tab.note, workspace.tabs))
        spec = tab
        workspace.activate(tab.id)
        await until(() => document.querySelector('.pages canvas.there'))
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
    canvas: boardScene(stage, you),
    chat: talkScene(you),
    flow: flowScene(stage, you, draw),
    bubbles: bubblesScene(stage, you),
    markdown: docScene(you),
    search: {
      period: SEARCH,
      still: 0,
      ready: async () => {
        ride = await opened(`${ROOT}/${RIDE_DATA}`)
        interviews = await opened(`${ROOT}/${INTERVIEWS}`)
        workspace.activate(stage.canvas.id)
      },
      tick: (phase) => {
        const ms = phase * SEARCH
        const step = stepOf(ms, [2000, 6000, 9700, 14200, 18700])
        searching(step)
        if (step === 1 || step === 3) {
          const query = step === 1 ? typedAt(firstQuery, ms - 2500) : typedAt(secondQuery, ms - 10200)
          if (query !== shownQuery) {
            shownQuery = query
            paletteWords.words = query
          }
        }
        const search = () => boxOf('button[aria-label="Search notes and commands"]')
        const picked = () => boxOf('[role="option"][aria-selected="true"]')
        follow(phase, SEARCH, [
          { at: 0, to: rest },
          { at: 900 / SEARCH, to: rest },
          { at: 1800 / SEARCH, to: search, press: true },
          { at: 3400 / SEARCH, to: nudged(search, 60, 50) },
          { at: 5600 / SEARCH, to: picked, press: true },
          { at: 7600 / SEARCH, to: rest },
          { at: 9300 / SEARCH, to: search, press: true },
          { at: 11000 / SEARCH, to: nudged(search, 50, 60) },
          { at: 13800 / SEARCH, to: picked, press: true },
          { at: 15800 / SEARCH, to: rest },
          { at: 18300 / SEARCH, to: tabButton(() => stage.canvas), press: true },
          { at: 20000 / SEARCH, to: rest },
        ])
      },
    },
    todos: todosScene(you),
  }
}
