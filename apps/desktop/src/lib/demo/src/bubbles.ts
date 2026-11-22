import { samePath } from '../../platform/src/api'
import { spaceMoving, tabOverview, toggleTabOverview, type Tab, workspace } from '../../workspace/src/api'
import { nudged, rest, shown, stepOf, stepper, type LoopScene } from './kit'
import { moveAt, type Move, PAUSE } from './motion'
import { boxOf, type Point, type Pointer } from './pointer'
import type { Stage } from './run'
import { PAGE_TITLE } from './space'

const T = {
  lift: 4560,
  dropped: 7000,
  opened: 9300,
  back: 12300,
  liftBack: 13960,
  home: 16500,
  board: 18300,
  again: 21800,
  end: 26000,
}
const EDGES = [T.dropped, T.opened, T.back, T.home, T.board, T.again]
const STATES: readonly { open: boolean; harbor: boolean; opening: boolean }[] = [
  { open: true, harbor: false, opening: false },
  { open: true, harbor: true, opening: false },
  { open: false, harbor: true, opening: true },
  { open: true, harbor: true, opening: true },
  { open: true, harbor: false, opening: true },
  { open: false, harbor: false, opening: false },
  { open: true, harbor: false, opening: false },
]
const windowOf = (name: string) => () => boxOf(`button.window[aria-label="${name}"]`)
export function bubblesScene(stage: Stage, you: () => Pointer): LoopScene {
  let ghost: HTMLElement | null = null
  let opening: Tab | null = null
  const spaceOf = (name: string) => workspace.spaces.find((one) => samePath(one.root, `/${name}`))
  const show = async (tab: Tab) => {
    const space = workspace.spaceOfTab(tab)
    if (space && workspace.activeSpaceId !== space) await workspace.showSpace(space)
    if (workspace.activeTabId !== tab.id) workspace.activate(tab.id)
  }
  const drop = () => {
    ghost?.remove()
    ghost = null
  }
  const go = stepper(async (to) => {
    const state = STATES[to] ?? STATES[0]
    if (!state) return
    drop()
    const target = spaceOf(state.harbor ? 'Harbor' : 'Kestrel')
    const page = stage.page
    if (page && target && workspace.spaceOfTab(page) !== target.id)
      await (await spaceMoving()).moveToSpace([page.id], target.id)
    const tab = state.opening ? opening : stage.canvas
    if (!state.open && tabOverview.open) toggleTabOverview()
    if (tab) await show(tab)
    if (state.open && !tabOverview.open) toggleTabOverview()
    await new Promise((done) => requestAnimationFrame(done))
  })
  const harbor = nudged(windowOf('Menu'), -30, 70)
  const kestrel = nudged(windowOf('Board'), 70, -20)
  const carry = (ms: number, from: number, to: number, moves: readonly Move[]) => {
    if (ms < from + PAUSE || ms >= to) {
      drop()
      return
    }
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
        opacity: '0.92',
        boxShadow: '0 14px 34px rgb(0 0 0 / 0.35)',
      })
      document.body.append(ghost)
    }
    const at: Point | null = moveAt(ms, moves).at
    if (ghost && at) {
      const box = ghost.getBoundingClientRect()
      ghost.style.transform = `translate(${at.x - box.width / 2}px, ${at.y - box.height / 2}px) scale(0.92) rotate(-2deg)`
    }
  }
  return {
    period: T.end,
    still: 0,
    ready: async () => {
      opening = workspace.tabs.find((one) => samePath(one.path, '/Harbor/Opening week.md')) ?? null
      const page = stage.page
      const away = spaceOf('Harbor')
      const home = spaceOf('Kestrel')
      if (page && away && home) {
        const moving = await spaceMoving()
        await moving.moveToSpace([page.id], away.id)
        await moving.moveToSpace([page.id], home.id)
      }
      await show(stage.canvas)
      if (!tabOverview.open) toggleTabOverview()
    },
    tick: (phase) => {
      const ms = phase * T.end
      go(stepOf(ms, EDGES))
      const tabs = () => boxOf('button.overview[aria-label="Tabs"]')
      const moves: Move[] = [
        { at: 0, to: rest },
        { at: 1300, to: rest },
        { at: 2500, to: windowOf('Birds') },
        { at: 3500, to: windowOf('Walks') },
        { at: T.lift - PAUSE, to: windowOf(PAGE_TITLE), press: true },
        { at: T.dropped, to: harbor, drag: true },
        { at: T.opened - PAUSE, to: windowOf('Opening week'), press: true },
        { at: T.opened + 1300, to: rest },
        { at: T.back - PAUSE, to: tabs, press: true },
        { at: T.liftBack - PAUSE, to: windowOf(PAGE_TITLE), press: true },
        { at: T.home, to: kestrel, drag: true },
        { at: T.board - PAUSE, to: windowOf('Board'), press: true },
        { at: T.board + 1400, to: rest },
        { at: T.again - PAUSE, to: tabs, press: true },
        { at: T.again + 1600, to: rest },
      ]
      shown(you(), ms, moves)
      if (ms < T.back) carry(ms, T.lift - PAUSE, T.dropped, moves)
      else carry(ms, T.liftBack - PAUSE, T.home, moves)
    },
  }
}
