import type { DemoCue } from '../../showcase/src/api'
import { chatStore } from '../../ai-chat/src/api'
import { ai, type Turn } from '../../ai-providers/src/api'
import { overlays } from '../../ui-kit/src/api'
import { paletteWords, tabOverview, toggleTabOverview, type Tab, workspace } from '../../workspace/src/api'
import { opened, phone, rest, shown, stepOf, stepper, type LoopScene } from './kit'
import { keysOf, type Move, PAUSE, typedAt } from './motion'
import { boxOf, type Pointer } from './pointer'
import type { Stage } from './run'
import { CHECKLIST, NOTES, RIDE_DATA, ROOT } from './space'
import { writer } from './writer'

type Draw = (cue: Pick<DemoCue, 'scene' | 'at' | 'still'>, now: number) => void
const ADDED = [
  { after: '- [ ] Ride test', words: 'Book the river loop for Saturday', lead: '\n- [ ] ' },
  { after: '- [ ] Shop window', words: 'Lights for the window display', lead: '\n- [ ] ' },
]
const ASKED = 'What is left before the launch?'
const ANSWER =
  'The river loop is booked and the ride test is done. Left: lights for the shop window, and the press kit goes out after the embargo lifts on Thursday.'
const T = {
  tree: 1600,
  note: 3200,
  typing: [4000, 4700],
  tick: 10500,
  search: 12200,
  query: 12800,
  picked: 15200,
  overview: 17500,
  board: 19700,
  ask: 21700,
  asked: 22300,
  answer: 23200,
  answered: 26600,
  shut: 28700,
  home: 30200,
  end: 34000,
}
const EDGES = [T.tree, T.note, T.search, T.picked, T.overview, T.board, T.ask, T.shut, T.home]
export function flowScene(stage: Stage, you: () => Pointer, draw: Draw): LoopScene {
  const keys = ADDED.map((one, index) => keysOf(one.words, 80 + index, 0.85))
  const query = keysOf('ride', 82, 1.2, false)
  let checklist: Tab | null = null
  let ride: Tab | null = null
  type Chat = Awaited<ReturnType<typeof chatStore>>['chat']
  let asking: Chat | null = null
  let told = ''
  let shownQuery: string | null = null
  const path = `${ROOT}/${CHECKLIST}`
  const write = writer(
    () => checklist,
    NOTES[CHECKLIST] ?? '',
    ADDED,
    [0, 1],
    (text) => (ticked ? text.replace('- [ ] Ride test', '- [x] Ride test') : text),
  )
  let ticked = false
  let tree = false
  let palette = false
  let right = false
  const go = stepper(async (to) => {
    const wantTree = phone() ? to === 1 : to >= 1 && to <= 8
    if (wantTree !== tree) {
      tree = wantTree
      if (tree) {
        workspace.revealFolder(`${ROOT}/Launch`)
        workspace.showPanel('tree')
      } else workspace.closePanel('left')
    }
    const tab = to === 2 || to === 3 ? checklist : to === 4 || to === 5 ? ride : stage.canvas
    if (tab && workspace.activeTabId !== tab.id) workspace.activate(tab.id)
    if ((to === 3) !== palette) {
      palette = to === 3
      shownQuery = null
      if (!palette) overlays.escape()
    }
    if ((to === 5) !== tabOverview.open) toggleTabOverview()
    if (__AI__ && (to === 7) !== right) {
      right = to === 7
      if (right) workspace.showPanel('ask')
      else workspace.closeRight()
    }
    await new Promise((done) => requestAnimationFrame(done))
  })
  const turnsAt = (ms: number): Turn[] => {
    if (ms < T.asked) return []
    const turns: Turn[] = [
      {
        id: 'flow-0',
        role: 'you',
        at: 0,
        parts: [{ kind: 'text', text: ASKED }],
        draft: { text: ASKED, attachments: [] },
      },
    ]
    if (ms < T.answer) return turns
    const words = ANSWER.split(' ')
    const count = Math.max(1, Math.ceil((words.length * (ms - T.answer)) / (T.answered - T.answer)))
    turns.push({ id: 'flow-1', role: 'model', at: 0, parts: [{ kind: 'text', text: words.slice(0, count).join(' ') }] })
    return turns
  }
  const tickBox = () => {
    for (const line of document.querySelectorAll('.cm-line')) {
      if (line.textContent.trim() !== 'Ride test') continue
      const box = (line.querySelector('input[type="checkbox"]') ?? line).getBoundingClientRect()
      return { x: box.left + Math.min(box.width, 16) / 2, y: box.top + box.height / 2 }
    }
    return null
  }
  return {
    period: T.end,
    still: 0,
    ready: async () => {
      checklist = await opened(path)
      ride = await opened(`${ROOT}/${RIDE_DATA}`)
      workspace.activate(stage.canvas.id)
      if (!__AI__) return
      const { chat } = await chatStore()
      if (!ai.providers.length) {
        const added = ai.add('compatible')
        ai.update(added.id, { baseUrl: 'https://ai.orden.so', model: 'assistant' })
      }
      chat.newThread()
      asking = chat
      if (chat.thread) chat.thread.title = 'Launch'
    },
    tick: (phase, now) => {
      const ms = phase * T.end
      const step = stepOf(ms, EDGES) % EDGES.length
      go(step)
      if ((step <= 1 || step >= 6) && !tabOverview.open) draw({ scene: 'canvas', at: 1, still: false }, now)
      const typing = step === 2 || step === 3
      const typed = keys.map((one, index) => (typing ? typedAt(one, ms - (T.typing[index] ?? 0)) : ''))
      const live = keys.map((one, index) => typing && ms < (T.typing[index] ?? 0) + one.took + 600)
      ticked = typing && ms >= T.tick + PAUSE
      write(typed, live)
      if (step === 3) {
        const words = typedAt(query, ms - T.query)
        if (words !== shownQuery) {
          shownQuery = words
          paletteWords.words = words
        }
      }
      const thread = asking?.thread
      if (asking && thread) {
        const turns = step === 7 ? turnsAt(ms) : []
        const key = JSON.stringify(
          turns.map((one) => one.parts.map((part) => (part.kind === 'text' ? part.text.length : 0))),
        )
        if (key !== told) {
          told = key
          thread.turns = turns
          asking.touched(thread)
        }
        const busy = step === 7 && ms >= T.asked && ms < T.answered
        if (asking.running.length > 0 !== busy) asking.running = busy ? [thread.id] : []
      }
      const search = () => boxOf('button[aria-label="Search notes and commands"]')
      const tabs = () => boxOf('button.overview[aria-label="Tabs"]')
      const left = () => boxOf('[data-side-toggle="left"]')
      const right = () => boxOf('[data-side-toggle="right"]')
      const moves: Move[] = [
        { at: 0, to: rest },
        { at: 900, to: rest },
        { at: T.tree - PAUSE, to: left, press: true },
        { at: T.note - PAUSE, to: () => boxOf(`.row[data-path="${path}"]`), press: true },
        { at: T.note + 1500, to: rest },
        { at: T.tick - 1200, to: rest },
        { at: T.tick, to: tickBox, press: true },
        { at: T.search - PAUSE, to: search, press: true },
        { at: T.query + 900, to: () => boxOf('[role="option"][aria-selected="true"]') },
        { at: T.picked - PAUSE, to: () => boxOf('[role="option"][aria-selected="true"]'), press: true },
        { at: T.overview - PAUSE, to: tabs, press: true },
        { at: T.board - PAUSE, to: () => boxOf('button.window[aria-label="Board"]'), press: true },
        ...(__AI__
          ? [
              { at: T.ask - PAUSE, to: right, press: true },
              { at: T.asked + 900, to: rest },
              { at: T.shut - 1400, to: rest },
              { at: T.shut - PAUSE, to: right, press: true },
            ]
          : []),
        ...(phone() ? [] : [{ at: T.home - PAUSE, to: left, press: true }]),
        { at: T.home + 1500, to: rest },
      ]
      shown(you(), ms, moves)
    },
  }
}
