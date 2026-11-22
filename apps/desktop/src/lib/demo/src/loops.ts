import { type ChatsDemo, portOf } from '@orden/contracts'
import { EditorView, setPeers } from '@orden/editor'
import type { DemoCue } from '../../showcase/src/api'
import { CanvasStore } from '../../canvas/src/api'
import { samePath } from '../../platform/src/api'
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
import { replacement, TEAM, writtenAt } from './scenes'
import { browsing, scriptOf, turnsAt, working } from './ai'
import { BEFORE, CHAT_NAME, chatAt, duringOf, PEOPLE, REACTIONS } from './chat'
import { inkAt, nextTip } from './ink'
import { boxOf, onPlane, type Point, Pointer, type Stop } from './pointer'
import { keysOf, moveAt, typedAt } from './motion'
import type { Stage } from './run'
import { BASE, LAUNCH, PAGE, PAGE_TITLE, PLAN_TEXT, RIDE_DATA, ROOT, ROUTES, INTERVIEWS, SPEC, WRITTEN } from './space'

export type { LoopScene }
type Draw = (cue: Pick<DemoCue, 'scene' | 'at' | 'still'> & { you?: boolean }, now: number) => void
const there = (phase: number, rest = 0.2): number => smooth(clamp((0.5 - Math.abs(phase - 0.5)) / (0.5 - rest)))
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
  return (typed: readonly string[]) => {
    const note = tab()?.note
    if (!note) return
    const key = typed.join('\u0000')
    if (key === said) return
    said = key
    const { text: wanted, carets } = writtenAt(
      text,
      typed.map((one) => one.length),
      written.map((one, index) => ({ ...one, words: typed[index] ?? '' })),
    )
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
const QUERY = 'ride'
const CHAT = 26000
const FLOWS = 30000
const ASK = 30000
const BUBBLES = 24000
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
  const reply = keysOf('Framing this one for the office.', 63)
  const planKeys = WRITTEN.map((one, index) => keysOf(one.words, 64 + index, 0.9))
  const compose = (text: string) => {
    const field = [...document.querySelectorAll<HTMLElement>('.cm-editor')].find(
      (one) => one.offsetParent && one.closest('form, .composer, footer'),
    )
    const view = field ? EditorView.findFromDOM(field) : null
    if (!view || view.state.doc.toString() === text) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  }
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
  let talk: { chats: ChatsDemo; path: string; ids: (string | null)[] } | null = null
  let talked = { said: 0, typing: null as string | null, reacted: 0 }
  let staging = false
  let lastPhase = 0
  const during = duringOf(`${location.origin}${BASE}demo/lan-party.png`)
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
      talk = { chats, path, ids: [] }
      talked = { said: 0, typing: null, reacted: 0 }
    } finally {
      staging = false
    }
  }
  return {
    chat: {
      period: CHAT,
      still: 0.9,
      ready: restage,
      tick: (phase) => {
        const wrapped = phase < lastPhase
        lastPhase = phase
        follow(phase, CHAT, [
          { at: 0, to: rest },
          { at: 0.42, to: rest },
          { at: 0.5, to: () => boxOf('.cm-editor .cm-content'), press: true },
          { at: 0.68, to: () => boxOf('.cm-editor .cm-content') },
          { at: 0.7, to: () => boxOf('button[aria-label="Send"]'), press: true },
          { at: 0.85, to: rest },
        ])
        compose(phase < 0.52 || phase >= 0.71 ? '' : typedAt(reply, (phase - 0.52) * CHAT))
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
          talk.ids[at] = line.picture
            ? talk.chats.picture(talk.path, line.from, line.picture, {
                width: 320,
                height: 200,
                name: 'lan-party.png',
                caption: line.body,
              })
            : talk.chats.say(talk.path, line.from, line.body)
        }
        for (let at = talked.reacted; at < now.reacted; at++) {
          const one = REACTIONS[at]
          const id = one ? talk.ids[one.line] : null
          if (one && id) talk.chats.react(talk.path, id, one.from, one.emoji)
        }
        talked = now
      },
    },
    flow: {
      period: FLOWS,
      still: 0.35,
      tick: (phase, now) => {
        const step = stepOf(phase, FLOW) % FLOW.length
        flowing(step)
        if (step === 0) draw({ scene: 'canvas', at: 1, still: false }, now)
        const ms = phase * FLOWS
        planWriter(
          planKeys.map((keys, index) =>
            step === 2
              ? typedAt(keys, ms - FLOWS * (0.27 + 0.02 * index))
              : step >= 3 && step <= 5
                ? (keys.shown.at(-1) ?? '')
                : '',
          ),
        )
        follow(phase, FLOWS, [
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
    bubbles: {
      period: BUBBLES,
      still: 0.55,
      tick: (phase, now) => {
        const step = stepOf(phase, [0.12, 0.32, 0.5, 0.84]) % 4
        draw({ scene: 'overview', at: step >= 1 && step <= 3 ? 1 : 0, still: false }, now)
        bubbling(step)
        const plan = () => boxOf(`button.window[aria-label="${PAGE_TITLE}"]`)
        const harbor = () => nudged(() => boxOf('button.window[aria-label="Menu"]'), 0, 30)()
        follow(phase, BUBBLES, [
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
          const { at } = moveAt(phase * BUBBLES, [
            { at: 0.3 * BUBBLES, to: plan },
            { at: 0.5 * BUBBLES, to: harbor, drag: true },
          ])
          if (ghost && at) {
            const box = ghost.getBoundingClientRect()
            ghost.style.transform = `translate(${at.x - box.width / 2}px, ${at.y - box.height / 2}px) scale(0.92)`
          }
        }
      },
    },
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
    write: {
      period: 24000,
      still: 0.5,
      tick: (phase, now) => draw({ scene: 'write', at: 0.3 + 0.7 * there(phase, 0.15), still: false }, now),
    },
  }
}
