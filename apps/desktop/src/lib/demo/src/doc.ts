import { setPeers } from '@orden/editor'
import { type Tab, workspace } from '../../workspace/src/api'
import { opened, phone, rest, scheme, shown, tabButton, type LoopScene } from './kit'
import { keysOf, type Keys, type Move, PAUSE, typedAt } from './motion'
import type { Pointer } from './pointer'
import { replacement, TEAM } from './scenes'
import { REPORT, RIDE_DATA, ROOT, ROUTES } from './space'

interface Part {
  who: number
  text: string
  units?: readonly string[]
  open?: string
  shut?: string
}
const OPEN = '- [ ] Book the café'
const SHUT = '- [x] Book the café'
export const PARTS: readonly Part[] = [
  { who: 0, text: '# Ride report\n\nSaturday on the river loop. Three riders, one flat tyre, **48 minutes**.' },
  { who: 1, text: '\n## Before we ride\n- [x] Tyres at 4 bar\n- [x] Lights charged\n' + OPEN },
  {
    who: 0,
    text: '\n## Speed\n$$\nv = \\frac{14\\ \\text{km}}{0.8\\ \\text{h}} \\approx 17.5\\ \\text{km/h}',
    units: [
      ...Array.from('\n## Speed\n$$\nv ='),
      ' \\frac{14\\ \\text{km}}{0.8\\ \\text{h}}',
      ' \\approx',
      ' 17.5',
      '\\ \\text{km/h}',
    ],
    open: '$$',
    shut: '\n$$',
  },
  { who: 2, text: '\n```js\nconst speed = km / (minutes / 60)', open: '```', shut: '\n```' },
  { who: 1, text: '\n| Rider | km | min |\n| --- | --- | --- |\n| Mara | 14 | 48 |\n| Jonas | 14 | 51 |' },
  { who: 2, text: '\nRoutes for next week: [Weekend routes](ROUTES)' },
]
const STARTS = [1800, 3600, 6400]
const PACE = 0.78
export interface Built {
  text: string
  carets: { who: number; head: number }[]
}
export function planOf(origin: string): { keys: Keys[]; starts: number[]; done: number } {
  const free = [...STARTS]
  const keys: Keys[] = []
  const starts: number[] = []
  PARTS.forEach((part, index) => {
    const typed = keysOf(part.units ?? part.text.replace('ROUTES', origin + ROUTES), 70 + index, PACE)
    const start = free[part.who] ?? 0
    keys.push(typed)
    starts.push(start)
    free[part.who] = start + typed.took + 700
  })
  return { keys, starts, done: free.reduce((most, one) => Math.max(most, one), 0) }
}
export function builtAt(plan: ReturnType<typeof planOf>, ms: number, ticked: boolean): Built {
  let text = ''
  const carets: Built['carets'] = []
  plan.keys.forEach((keys, index) => {
    const start = plan.starts[index] ?? 0
    const part = PARTS[index]
    if (!part || ms < start) return
    const typed = typedAt(keys, ms - start)
    const shut = part.open && part.shut && typed.includes(part.open) ? part.shut : ''
    text += typed
    if (ms < start + keys.took + 600) carets.push({ who: part.who, head: text.length })
    text += `${shut}\n`
  })
  return { text: ticked ? text.replace(OPEN, SHUT) : text, carets }
}
export function docScene(you: () => Pointer): LoopScene {
  const plan = planOf(location.origin)
  const at = { tab: 1300, tick: plan.done + 900, back: plan.done + 3600, end: plan.done + 5200 }
  let report: Tab | null = null
  let data: Tab | null = null
  const ride = () => data
  let said = ''
  const write = (built: Built) => {
    const note = report?.note
    if (!note) return
    const key = `${built.text.length}:${built.text.slice(-24)}:${built.carets.map((one) => one.head).join()}`
    if (key === said) return
    said = key
    const change = replacement(note.live.text.toString(), built.text)
    if (change) note.live.arrived([change])
    note.live.announce([
      setPeers.of(
        built.carets.map(({ who, head }) => ({
          id: who + 1,
          name: TEAM[who]?.name ?? '',
          colour: TEAM[who]?.[scheme()] ?? '',
          head,
          anchor: head,
        })),
      ),
    ])
  }
  const box = () => {
    for (const line of document.querySelectorAll('.cm-line')) {
      if (!line.textContent.includes('Book the café')) continue
      const mark = line.querySelector('input[type="checkbox"]') ?? line
      const shape = mark.getBoundingClientRect()
      return mark === line
        ? { x: shape.left + 12, y: shape.top + shape.height / 2 }
        : { x: shape.left + shape.width / 2, y: shape.top + shape.height / 2 }
    }
    return null
  }
  return {
    period: at.end,
    still: 0,
    ready: async () => {
      report = await opened(`${ROOT}/${REPORT}`)
      write({ text: '', carets: [] })
      data = await opened(`${ROOT}/${RIDE_DATA}`)
    },
    tick: (phase) => {
      const ms = phase * at.end
      const showing = ms >= at.tab + PAUSE && ms < at.back + PAUSE ? report : ride()
      if (showing && workspace.activeTabId !== showing.id) workspace.activate(showing.id)
      if (showing === report || ms < at.tab) write(builtAt(plan, ms < at.tab ? 0 : ms, ms >= at.tick + PAUSE))
      const scroller = [...document.querySelectorAll<HTMLElement>('.cm-scroller')].find((one) => one.offsetParent)
      const last = scroller?.querySelector('.cm-content > :last-child')
      if (scroller && last && showing === report) {
        const bottom = last.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop
        const wanted = Math.max(0, bottom + 70 - scroller.clientHeight)
        const step = (wanted - scroller.scrollTop) * 0.06
        if (Math.abs(step) > 0.3) scroller.scrollTop += step
      }
      const moves: Move[] = phone()
        ? [
            { at: 0, to: rest },
            { at: at.tick - 1200, to: rest },
            { at: at.tick, to: box, press: true },
            { at: at.tick + 1600, to: rest },
          ]
        : [
            { at: 0, to: rest },
            { at: at.tab, to: tabButton(() => report), press: true },
            { at: at.tab + 1700, to: rest },
            { at: at.tick - 1300, to: rest },
            { at: at.tick, to: box, press: true },
            { at: at.back, to: tabButton(ride), press: true },
            { at: at.back + 1300, to: rest },
          ]
      shown(you(), ms, moves)
    },
  }
}
