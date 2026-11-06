import type { Panel, PanelSide } from '../workspace.svelte'

export interface Sides {
  panel: Panel | null
  rightPanel: Panel | null
  right: Panel[]
  covered?: boolean
}

export function sideOf(right: readonly Panel[], panel: Panel): PanelSide {
  return right.includes(panel) ? 'right' : 'left'
}

export function openOn(sides: Sides, side: PanelSide): Panel | null {
  if (side === 'right') return sides.covered ? null : sides.rightPanel
  return sides.panel
}

function heldOn(sides: Sides, side: PanelSide): Panel | null {
  return side === 'right' ? sides.rightPanel : sides.panel
}

function uncovered(sides: Sides): Sides {
  return sides.covered ? { ...sides, covered: false } : sides
}

export function panelsOn(
  right: readonly Panel[],
  side: PanelSide,
  every: readonly Panel[],
): Panel[] {
  return side === 'right'
    ? right.filter((one) => every.includes(one))
    : every.filter((one) => !right.includes(one))
}

export function showing(sides: Sides, next: Panel): Sides {
  if (sideOf(sides.right, next) === 'right') {
    return uncovered({ ...sides, rightPanel: openOn(sides, 'right') === next ? null : next })
  }

  return { ...sides, panel: sides.panel === next ? null : next }
}

export function closing(sides: Sides, side: PanelSide): Sides {
  return side === 'right' ? { ...sides, rightPanel: null } : { ...sides, panel: null }
}

export function moving(sides: Sides, panel: Panel, side: PanelSide): Sides {
  const was = sideOf(sides.right, panel)
  if (was === side || !mayLiveOn(panel, side)) return sides

  const open = heldOn(sides, was) === panel

  if (side === 'right') {
    const moved = {
      ...sides,
      right: [...sides.right, panel],
      panel: open ? null : sides.panel,
      rightPanel: open ? panel : sides.rightPanel,
    }
    return open ? uncovered(moved) : moved
  }

  return {
    ...sides,
    right: sides.right.filter((one) => one !== panel),
    panel: open ? panel : sides.panel,
    rightPanel: open ? null : sides.rightPanel,
  }
}

export const STARTS_RIGHT: readonly Panel[] = ['outline', 'links', 'ask', 'tasks']

const RIGHT_ONLY: readonly Panel[] = ['tasks']

export function mayLiveOn(panel: Panel, side: PanelSide): boolean {
  return side === 'right' || !RIGHT_ONLY.includes(panel)
}

export function leftPanelFrom(saved: Panel | null | undefined): Panel | null {
  return saved && mayLiveOn(saved, 'left') ? saved : null
}

export const PANELS: readonly Panel[] = [
  'tree',
  'outline',
  'search',
  'tasks',
  'chats',
  'time',
  'links',
  'ask',
]

const ARRANGED_BEFORE: readonly Panel[] = ['tree', 'outline', 'search', 'links']

export function rightFrom(
  saved: readonly Panel[] | undefined,
  known: readonly Panel[] = ARRANGED_BEFORE,
): Panel[] {
  if (!saved) return [...STARTS_RIGHT]

  const right = [
    ...saved,
    ...STARTS_RIGHT.filter((one) => !saved.includes(one) && !known.includes(one)),
  ]
  return [...right, ...RIGHT_ONLY.filter((one) => !right.includes(one))]
}

export function tabsShown(count: number, room: number, tab: number, gap = 2, inset = 6): number {
  if (room <= 0 || tab <= 0) return count

  const width = (n: number) => n * tab + Math.max(0, n - 1) * gap + inset
  if (width(count) <= room) return count

  let fit = count - 1
  while (fit > 1 && width(fit + 1) > room) fit -= 1
  return Math.max(1, fit)
}

export function splitTabs<T>(items: readonly T[], shown: number, isOn: (item: T) => boolean) {
  const drawn = items.slice(0, shown)
  const on = items.find(isOn)
  if (on !== undefined && !drawn.includes(on)) drawn[drawn.length - 1] = on

  return { drawn, behind: items.filter((item) => !drawn.includes(item)) }
}

export const PHONE_TABS = ['tree', 'tasks', 'chats', 'search'] as const satisfies readonly Panel[]

export type PhoneTab = (typeof PHONE_TABS)[number]

function isPhoneTab(panel: Panel | null | undefined): panel is PhoneTab {
  return PHONE_TABS.some((one) => one === panel)
}

export function phoneRight(right: readonly Panel[]): Panel[] {
  return right.filter((one) => !isPhoneTab(one))
}
