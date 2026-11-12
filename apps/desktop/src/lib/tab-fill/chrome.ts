import { dur } from '../motion'

type Edge = 'start' | 'end' | 'top' | 'bottom'

const AWAY: Record<Edge, [number, number]> = {
  start: [-1, 0],
  end: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
}

const TRAVEL = 16

function isEdge(value: string | undefined): value is Edge {
  return value !== undefined && value in AWAY
}

function easing(): string {
  const said = getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim()
  return said || 'ease-out'
}

function parts(): [HTMLElement, Edge][] {
  return [...document.querySelectorAll<HTMLElement>('[data-chrome]')].flatMap((one) => {
    const edge = one.dataset.chrome
    return isEdge(edge) ? [[one, edge] as [HTMLElement, Edge]] : []
  })
}

export async function chromeGoes(): Promise<void> {
  await Promise.all(parts().map(([one, edge]) => move(one, edge, true)))
}

export function chromeComes(): void {
  for (const [one, edge] of parts()) void move(one, edge, false)
}

export function chromeStays(): void {
  for (const [one] of parts()) {
    if (typeof one.getAnimations !== 'function') continue
    for (const held of one.getAnimations()) held.cancel()
  }
}

function move(one: HTMLElement, edge: Edge, going: boolean): Promise<unknown> {
  if (typeof one.animate !== 'function') return Promise.resolve()

  const [across, down] = AWAY[edge]
  const away = `translate(${across * TRAVEL}px, ${down * TRAVEL}px)`
  const here = { opacity: 1, transform: 'none' }
  const there = { opacity: 0, transform: away }

  return one
    .animate(going ? [here, there] : [there, here], {
      duration: dur(going ? 130 : 210),
      easing: easing(),
      fill: going ? 'forwards' : 'none',
    })
    .finished.catch(() => undefined)
}
