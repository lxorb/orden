import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  type Folded,
  type Folding,
  meet,
  spacesOf,
  Kept,
  without,
} from '../../platform/src/api'

export const STORAGE_KEY = 'orden:graph'
export const MOST_GROUPS = 6
const LONGEST_QUERY = 200
const SETTLING = 700
export const LEAST_SPREAD = 0.25
export const MOST_SPREAD = 4
export const LEAST_DISTANCE = 12
export const MOST_DISTANCE = 96
export const LEAST_PUSH = 40
export const MOST_PUSH = 400
export const SHALLOWEST = 1
export const DEEPEST = 5
export const LEAST_FADE = 0.25
export const MOST_FADE = 4
export const LEAST_LINES = 1
export const MOST_LINES = 3
interface ColourGroup {
  query: string
  colour: number
}
export interface GraphSettings {
  filter: string
  orphans: boolean
  attachments: boolean
  groups: ColourGroup[]
  spread: number
  gather: boolean
  distance: number
  push: number
  arrows: boolean
  sized: boolean
  lines: number
  fade: number
  depth: number
}
export const DEFAULT_GRAPH: GraphSettings = {
  filter: '',
  orphans: true,
  attachments: false,
  groups: [],
  spread: 1,
  gather: true,
  distance: 36,
  push: 150,
  arrows: false,
  sized: true,
  lines: 2,
  fade: 1,
  depth: 1,
}
function held(value: unknown, least: number, most: number, fallback: number): number {
  if (!isNumber(value)) return fallback
  return Math.min(most, Math.max(least, value))
}
function groupsOf(value: unknown): ColourGroup[] {
  if (!Array.isArray(value)) return []
  const out: ColourGroup[] = []
  for (const one of value) {
    if (out.length >= MOST_GROUPS) break
    if (!isRecord(one) || !isString(one.query)) continue
    out.push({
      query: one.query.slice(0, LONGEST_QUERY),
      colour: Math.round(held(one.colour, 1, MOST_GROUPS, 1)),
    })
  }
  return out
}
export function graphSettingsOf(value: unknown): GraphSettings {
  if (!isRecord(value)) return { ...DEFAULT_GRAPH }
  return {
    filter: isString(value.filter) ? value.filter.slice(0, LONGEST_QUERY) : DEFAULT_GRAPH.filter,
    orphans: isBoolean(value.orphans) ? value.orphans : DEFAULT_GRAPH.orphans,
    attachments: isBoolean(value.attachments) ? value.attachments : DEFAULT_GRAPH.attachments,
    groups: groupsOf(value.groups),
    spread: held(value.spread, LEAST_SPREAD, MOST_SPREAD, DEFAULT_GRAPH.spread),
    gather: isBoolean(value.gather) ? value.gather : DEFAULT_GRAPH.gather,
    distance: Math.round(held(value.distance, LEAST_DISTANCE, MOST_DISTANCE, DEFAULT_GRAPH.distance)),
    push: Math.round(held(value.push, LEAST_PUSH, MOST_PUSH, DEFAULT_GRAPH.push)),
    arrows: isBoolean(value.arrows) ? value.arrows : DEFAULT_GRAPH.arrows,
    sized: isBoolean(value.sized) ? value.sized : DEFAULT_GRAPH.sized,
    lines: Math.round(held(value.lines, LEAST_LINES, MOST_LINES, DEFAULT_GRAPH.lines)),
    fade: held(value.fade, LEAST_FADE, MOST_FADE, DEFAULT_GRAPH.fade),
    depth: Math.round(held(value.depth, SHALLOWEST, DEEPEST, DEFAULT_GRAPH.depth)),
  }
}
export function sameGraph(one: GraphSettings, other: GraphSettings): boolean {
  return JSON.stringify(one) === JSON.stringify(other)
}
interface Held extends Folded {
  settings: GraphSettings
  sent: boolean
}
function read(saved: unknown): Record<string, Held> {
  return spacesOf(saved, (one) => ({
    settings: graphSettingsOf(one.settings),
    sent: one.sent !== false,
  }))
}
const SETTINGS: Folding<GraphSettings> = {
  fold: (theirs, mine) => (sameGraph(theirs, DEFAULT_GRAPH) ? mine : theirs),
  same: sameGraph,
}
const UNSENT: Folding<GraphSettings> = { fold: (_theirs, mine) => mine, same: sameGraph }
export class SpaceGraphSettings {
  private keeping = new Kept(STORAGE_KEY, read)
  private get spaces(): Record<string, Held> {
    return this.keeping.value
  }
  private set spaces(value: Record<string, Held>) {
    this.keeping.value = value
  }
  private pushing: Record<string, ReturnType<typeof setTimeout>> = {}
  private offering: string[] = []
  constructor(private readonly root: () => string | null) {}
  reread(): void {
    this.keeping.reread()
  }
  of(root: string): GraphSettings {
    return this.spaces[root]?.settings ?? DEFAULT_GRAPH
  }
  get here(): GraphSettings {
    const root = this.root()
    return root === null ? DEFAULT_GRAPH : this.of(root)
  }
  set(change: Partial<GraphSettings>) {
    const root = this.root()
    if (root === null) return
    const next = graphSettingsOf({ ...this.of(root), ...change })
    if (sameGraph(next, this.of(root))) return
    this.put(root, next)
  }
  take(view: string | undefined) {
    if (!view) return
    let parsed: unknown
    try {
      parsed = JSON.parse(view)
    } catch {
      return
    }
    const root = this.root()
    if (root === null) return
    const next = graphSettingsOf(parsed)
    if (sameGraph(next, this.of(root))) return
    this.put(root, next)
  }
  reset() {
    const root = this.root()
    if (root === null || sameGraph(this.of(root), DEFAULT_GRAPH)) return
    this.put(root, { ...DEFAULT_GRAPH })
  }
  spaceMoved(from: string, to: string) {
    const kept = this.spaces[from]
    if (!kept || from === to) return
    this.spaces = { ...without(this.spaces, from), [to]: kept }
    this.write()
  }
  forget(root: string) {
    if (!(root in this.spaces)) return
    this.spaces = without(this.spaces, root)
    this.write()
  }
  adopt(root: string, theirs: unknown, accountId: string) {
    const account = graphSettingsOf(theirs)
    const kept = this.spaces[root]
    const unsent = kept?.sent === false && kept.account === accountId
    const met = meet(kept, accountId, kept?.settings ?? DEFAULT_GRAPH, account, unsent ? UNSENT : SETTINGS)
    if (!met) return
    const sent = !met.tell
    if (!kept || !sameGraph(kept.settings, met.value) || kept.account !== accountId || kept.sent !== sent) {
      this.spaces = { ...this.spaces, [root]: { settings: met.value, account: accountId, sent } }
      this.write()
    }
    if (met.tell) this.offer(root)
  }
  private offer(root: string) {
    if (this.offering.includes(root)) return
    this.offering = [...this.offering, root]
    void this.push(root).finally(() => {
      this.offering = this.offering.filter((one) => one !== root)
    })
  }
  private put(root: string, settings: GraphSettings) {
    this.spaces = {
      ...this.spaces,
      [root]: { settings, account: this.spaces[root]?.account ?? null, sent: false },
    }
    this.soon(root)
  }
  private soon(root: string) {
    const held = this.pushing[root]
    if (held !== undefined) clearTimeout(held)
    const waiting = setTimeout(() => {
      this.pushing = without(this.pushing, root)
      this.write()
      void this.push(root)
    }, SETTLING)
    this.pushing = { ...this.pushing, [root]: waiting }
  }
  flush() {
    for (const [root, held] of Object.entries(this.pushing)) {
      clearTimeout(held)
      void this.push(root)
    }
    this.pushing = {}
    this.write()
  }
  private async push(root: string) {
    const { push } = await import('./pushing')
    const settings = this.of(root)
    await push(
      root,
      (api, token, spaceId) => api.saveGraphSettings(token, spaceId, settings),
      (landed) => this.said(root, landed, settings),
      (answer) => sameGraph(graphSettingsOf(answer.graph), settings),
    )
  }
  private said(root: string, landed: boolean, settings: GraphSettings) {
    const held = this.spaces[root]
    if (!held || held.sent === landed || (landed && !sameGraph(held.settings, settings))) return
    this.spaces = { ...this.spaces, [root]: { ...held, sent: landed } }
    this.write()
  }
  private write() {
    this.keeping.write()
  }
}
