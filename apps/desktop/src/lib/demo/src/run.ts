import { webPages } from '@orden/contracts'
import { setPeers } from '@orden/editor'
import { emptyCanvas, writeCanvas } from '@orden/markdown/canvas'
import type { Hand } from '@orden/markdown/plane'
import { CanvasStore } from '../../canvas/src/api'
import { rooms } from '../../collab/src/api'
import { invoke, samePath } from '../../platform/src/api'
import { isDemoCue, type DemoCue } from '../../showcase/src/api'
import { undoToast } from '../../undo-toast/src/api'
import { tabOverview, toggleTabOverview, type Tab, workspace } from '../../workspace/src/api'
import { holdDatabases } from './held'
import { drifted, type Frame, frameAt, type Point, replacement, type Scene, TEAM, writtenAt } from './scenes'
import {
  CANVAS,
  LAUNCH,
  NEIGHBOURS,
  siteOf,
  NOTES,
  PAGE,
  PAGE_TITLE,
  PICTURES,
  PLAN,
  PLAN_TEXT,
  PRESS,
  ROOT,
  SPACE,
} from './space'

const at = (path: string) => `${ROOT}/${path}`
const FOLDERS = ['Research', 'Design', LAUNCH]
export async function seed(): Promise<void> {
  holdDatabases(window)
  const origin = location.origin
  for (const { name, notes } of NEIGHBOURS) {
    await invoke('create_space', { name })
    for (const [path, content] of Object.entries(notes))
      await invoke('write_note', { path: `/${name}/${path}`, content })
  }
  await invoke('create_space', { name: SPACE })
  for (const folder of FOLDERS) await invoke('create_folder', { path: at(folder) })
  for (const [path, content] of Object.entries(NOTES)) await invoke('write_note', { path: at(path), content })
  const first = frameAt('canvas', 0, origin)
  await invoke('write_note', {
    path: at(CANVAS),
    content: writeCanvas({ ...emptyCanvas(), nodes: first.nodes, edges: first.edges }),
  })
  for (const path of PICTURES) {
    const drawn = await fetch(`/demo/${path.slice(path.lastIndexOf('/') + 1)}`)
    await invoke('write_bytes', { path: at(path), bytes: new Uint8Array(await drawn.arrayBuffer()) })
  }
}
const until = async <T>(found: () => T | null | undefined): Promise<T> => {
  for (;;) {
    const one = found()
    if (one) return one
    await new Promise((done) => setTimeout(done, 30))
  }
}
const HANDS_EVERY = 90
const nextFrame = () => new Promise((done) => requestAnimationFrame(done))
interface Stage {
  canvas: Tab
  plan: Tab
  page: Tab | null
}
async function staged(): Promise<Stage> {
  await until(() => workspace.restored && workspace.spaces.some((one) => samePath(one.root, ROOT)))
  for (const { name, notes } of NEIGHBOURS) {
    const other = workspace.spaces.find((one) => samePath(one.root, `/${name}`))
    if (!other) continue
    if (workspace.activeSpaceId !== other.id) await workspace.showSpace(other.id)
    for (const path of Object.keys(notes)) await workspace.open(`/${name}/${path}`)
  }
  const space = workspace.spaces.find((one) => samePath(one.root, ROOT))
  if (space && workspace.activeSpaceId !== space.id) await workspace.showSpace(space.id)
  const canvasPath = at(CANVAS)
  await workspace.open(at(PLAN), { activate: false })
  const pageId = workspace.openPage(location.origin + PAGE)
  await workspace.openCanvas(canvasPath)
  const canvas = await until(() => workspace.tabs.find((one) => samePath(one.path, canvasPath)))
  const plan = await until(() => workspace.tabs.find((one) => samePath(one.path, at(PLAN))))
  const page = workspace.tabs.find((one) => one.id === pageId) ?? null
  if (page) {
    page.note.name = PAGE_TITLE
    webPages().named(page.id, location.origin + PAGE, PAGE_TITLE)
  }
  workspace.activate(canvas.id)
  const ours = new Set([canvas.id, plan.id, page?.id])
  workspace.closeEach(
    workspace.tabs.filter((one) => one.path?.startsWith(`${ROOT}/`) && !ours.has(one.id)).map((one) => one.id),
  )
  await until(() => CanvasStore.drawing(canvas.note, workspace.tabs))
  const scheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const people = (who: readonly number[]) => ({
    people: who.map((one) => ({
      key: `demo-${one}`,
      name: TEAM[one]?.name ?? '',
      face: null,
      fill: TEAM[one]?.[scheme()] ?? '',
    })),
    mine: 0,
  })
  rooms.heard(canvas.note.key, 3, people([0, 1, 2]))
  rooms.heard(plan.note.key, 2, people([0, 1]))
  if (page) rooms.heard(page.note.key, 1, people([2]))
  return { canvas, plan, page }
}
export async function play(): Promise<void> {
  const site = siteOf(location)
  const stage = await staged()
  const origin = location.origin
  let cue: DemoCue = { orden: 'demo', scene: 'canvas', at: 0, still: false }
  let began = performance.now()
  let drawn: Frame | null = null
  let shownSince = 0
  let typedKey = ''
  let tree = false
  let moved = false
  let settling = false
  let want: Frame = frameAt('canvas', 0, origin)
  const scheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const hands = (points: readonly Point[]): Hand[] =>
    points.map((one, index) => ({
      id: index + 1,
      name: TEAM[index]?.name ?? '',
      colour: TEAM[index]?.[scheme()] ?? '',
      at: one,
      stroke: null,
    }))
  const tabFor = (frame: Frame): Tab => {
    if (frame.shown === 'note') return stage.plan
    if (frame.shown === 'page' && stage.page) return stage.page
    return stage.canvas
  }
  const showPage = () => {
    if (stage.page) webPages().named(stage.page.id, location.origin + PAGE, PAGE_TITLE)
    const button = document.querySelector<HTMLButtonElement>('.card .rows .orden-button:not(.is-quiet)')
    button?.click()
  }
  const settle = async () => {
    if (settling) return
    settling = true
    try {
      for (let step = 0; step < 12; step++) {
        const frame = want
        const tab = tabFor(frame)
        if (workspace.activeTabId !== tab.id) {
          workspace.activate(tab.id)
          if (tab === stage.page) {
            await nextFrame()
            showPage()
          }
          continue
        }
        if (frame.tree !== tree) {
          tree = frame.tree
          if (tree) {
            workspace.revealFolder(at(LAUNCH))
            workspace.showPanel('tree')
          } else workspace.closePanel('left')
          continue
        }
        if (frame.moved !== moved) {
          moved = frame.moved
          await (moved ? workspace.move(at(PRESS), at(LAUNCH)) : workspace.move(at(`${LAUNCH}/${PRESS}`), ROOT))
          await nextFrame()
          undoToast.dismiss()
          continue
        }
        if (frame.overview !== tabOverview.open) {
          toggleTabOverview()
          continue
        }
        break
      }
    } finally {
      settling = false
    }
  }
  const type = (frame: Frame, fresh: boolean) => {
    const key = frame.typed.join()
    if (key === typedKey && !fresh) return
    typedKey = key
    const live = stage.plan.note.live
    const { text, carets } = writtenAt(PLAN_TEXT, frame.typed)
    const change = replacement(live.text.toString(), text)
    if (change) live.arrived([change])
    live.announce([
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
  const phone = document.documentElement.dataset.demo === 'phone'
  let store: CanvasStore | null = null
  let handsAt = -Infinity
  let made = { scene: cue.scene, at: -1, frame: want }
  const draw = (now: number) => {
    const still = cue.still === true
    const at = still ? 1 : cue.at
    if (made.scene !== cue.scene || made.at !== at)
      made = { scene: cue.scene, at, frame: frameAt(cue.scene, at, origin, phone) }
    const { frame } = made
    const showing = CanvasStore.drawing(stage.canvas.note, workspace.tabs)
    if (showing !== store) {
      drawn = null
      handsAt = -Infinity
    }
    store = showing
    if (store) paint(store, frame, now)
    if (undoToast.batch.length || undoToast.own) undoToast.dismiss()
    type(frame, frame.shown === 'note' && shownSince++ < 40)
    if (frame.shown !== 'note') shownSince = 0
    drawn = frame
    const moving = frame.shown !== want.shown || frame.tree !== want.tree || frame.moved !== want.moved
    want = frame
    if (moving || frame.overview !== tabOverview.open) void settle()
  }
  const paint = (into: CanvasStore, frame: Frame, now: number) => {
    if (drawn?.cards !== frame.cards) into.arrived({ ...into.canvas, nodes: frame.nodes, edges: frame.edges })
    const view = into.camera
    const { scale } = frame.view
    if (view.x !== frame.view.x || view.y !== frame.view.y || view.scale !== scale)
      into.camera = { x: frame.view.x, y: frame.view.y, scale }
    if (now - handsAt >= HANDS_EVERY || cue.still) {
      handsAt = now
      into.handsAre(hands(cue.still ? frame.hands : drifted(frame.hands, (now - began) / 1000)))
    }
  }
  let ticking = false
  const tick = (now: number) => {
    draw(now)
    ticking = cue.still !== true
    if (ticking) requestAnimationFrame(tick)
  }
  const wake = () => {
    if (!ticking) {
      ticking = true
      requestAnimationFrame(tick)
    }
  }
  addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.origin !== site || event.source !== parent || !isDemoCue(event.data)) return
    const scene: Scene = event.data.scene
    if (scene !== cue.scene) began = performance.now()
    cue = event.data
    if (cue.still) draw(performance.now())
    else wake()
  })
  draw(performance.now())
  await nextFrame()
  await nextFrame()
  wake()
  parent.postMessage({ orden: 'demo', ready: true }, site)
}
