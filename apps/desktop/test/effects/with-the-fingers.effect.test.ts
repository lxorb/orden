import { flushSync, mount, unmount } from 'svelte'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import arrowSource from '../../src/lib/back-swipe/SwipeArrow.svelte?raw'
import appSource from '../../src/App.svelte?raw'
import pullSource from '../../src/lib/PullMark.svelte?raw'
import base from '../../../../packages/themes/src/base.css?raw'

vi.mock('../../src/lib/workspace.svelte', () => ({
  workspace: { showing: (pane: string) => (pane === 'p' ? { id: 't' } : null) },
}))

const SwipeArrow = (await import('../../src/lib/back-swipe/SwipeArrow.svelte')).default
const { swiping } = await import('../../src/lib/back-swipe/shown.svelte')

const MOVES = new Set([
  'all',
  'transform',
  'translate',
  'scale',
  'rotate',
  'opacity',
  'left',
  'top',
  'right',
  'bottom',
  'inset',
  'width',
  'height',
])
const TIMING =
  /^(?:[\d.]+m?s|ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|normal|allow-discrete|none|initial|inherit|unset)$/

function eased(transition: string): string[] {
  if (!transition.trim()) return []
  const flat = transition.replace(/[a-z-]+\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ' ')
  return flat.split(',').flatMap((item) => {
    const words = item.trim().split(/\s+/).filter(Boolean)
    if (words.length === 1 && words[0] === 'none') return []
    const named = words.filter((word) => !TIMING.test(word))
    return named.length ? named : ['all']
  })
}

function sheetOf(source: string): string {
  const css = /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? ''
  return css.replace(/:global\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
}

function wear(...sheets: string[]) {
  const worn: HTMLStyleElement[] = []
  beforeAll(() => {
    for (const one of sheets) {
      const style = document.createElement('style')
      style.textContent = one
      document.head.append(style)
      worn.push(style)
    }
  })
  afterAll(() => {
    for (const one of worn) one.remove()
  })
}

function easing(element: Element, top: Element): string[] {
  const found: string[] = []
  const look = (at: Element) => {
    const style = getComputedStyle(at)
    const what = `${at.tagName.toLowerCase()}.${[...at.classList].join('.')}`
    for (const one of eased(style.transition || style.transitionProperty || ''))
      if (MOVES.has(one)) found.push(`${what} eases ${one}`)
    const animation = style.animationName || style.animation || ''
    if (animation && !/^none\b/.test(animation.trim())) found.push(`${what} plays ${animation}`)
  }
  for (const one of element.querySelectorAll('*')) look(one)
  for (let at: Element | null = element; at && at !== top.parentElement; at = at.parentElement)
    look(at)
  return found
}

describe('reading what a transition eases', () => {
  test('names what it eases, and `all` where it names nothing', () => {
    expect(eased('transform var(--dur-instant) var(--ease-out), color 1s')).toEqual([
      'transform',
      'color',
    ])
    expect(eased('0.2s cubic-bezier(0.3, 1, 0.3, 1) scale')).toEqual(['scale'])
    expect(eased('1s ease')).toEqual(['all'])
    expect(eased('none')).toEqual([])
    expect(eased('')).toEqual([])
  })
})

describe("the swipe's arrow, while the fingers are on", () => {
  wear(base, sheetOf(arrowSource))
  const room = { x: 0, y: 40, width: 800, height: 560 }

  const RUNS: { name: string; before: ('went' | 'stayed')[]; progress: number }[] = [
    { name: 'coming in', before: [], progress: 0.3 },
    { name: 'full', before: [], progress: 1 },
    { name: 'pulled past full', before: [], progress: 1.4 },
    { name: 'straight after one that stayed', before: ['stayed'], progress: 0.2 },
    { name: 'full straight after one that stayed', before: ['stayed'], progress: 1.2 },
    { name: 'straight after one that went', before: ['went'], progress: 0.2 },
  ]

  for (const side of ['left', 'right'] as const) {
    for (const run of RUNS) {
      test(`${run.name}, from the ${side}: nothing on it eases`, () => {
        const target = document.createElement('div')
        document.body.append(target)
        const arrow = mount(SwipeArrow, { target, props: { unseen: () => undefined } })
        try {
          Object.assign(swiping, {
            tab: 't',
            pane: 'p',
            room,
            side,
            stage: 'tracking',
            progress: 1.1,
            travel: 300,
          })
          flushSync()
          for (const stage of run.before) {
            swiping.stage = stage
            flushSync()
          }
          Object.assign(swiping, {
            stage: 'tracking',
            progress: run.progress,
            travel: 300 * run.progress,
          })
          flushSync()
          const circle = target.querySelector('.nib-swipe')
          if (!circle) throw new Error('no arrow')
          expect(easing(circle, target.querySelector('.track') ?? circle)).toEqual([])
          expect(getComputedStyle(circle).opacity).toBe('1')
        } finally {
          void unmount(arrow)
          target.remove()
          Object.assign(swiping, {
            tab: null,
            pane: null,
            room: null,
            stage: 'tracking',
            progress: 0,
            travel: 0,
          })
        }
      })
    }
  }
})

describe('a drawer under the thumb', () => {
  wear(sheetOf(appSource))
  test.each([
    ['wide', 'left', ''],
    ['wide', 'left', 'open'],
    ['wide', 'right', ''],
    ['wide', 'right', 'open'],
    ['narrow', 'left', ''],
    ['narrow', 'left', 'open'],
    ['narrow', 'right', ''],
    ['narrow', 'right', 'open'],
  ])(
    '%s, the %s drawer, %s: still settling from the last drag or not, nothing eases',
    (width, side, open) => {
      const host = document.createElement('div')
      host.setAttribute('data-drawer', '')
      if (width === 'narrow') host.setAttribute('data-narrow', '')
      const layer = side === 'right' ? 'panels right' : 'panels'
      for (const settling of ['', 'settling']) {
        const at = `held dragging ${open} ${settling}`
        host.innerHTML = `<div class="${layer} ${at}"></div>
        <div class="document ${side === 'left' ? at : ''}"><div class="scrim ${at}"></div></div>`
        document.body.append(host)
        const moving = [host.querySelector('.panels'), host.querySelector('.scrim')]
        if (side === 'left') moving.push(host.querySelector('.document'))
        for (const one of moving) {
          if (!one) throw new Error('no layer')
          expect(easing(one, one), settling || 'not settling').toEqual([])
        }
        host.remove()
      }
    },
  )
})

describe("the pull's mark", () => {
  wear(sheetOf(pullSource))
  test.each(['', 'ready'])('%s: nothing eases', (state) => {
    const host = document.createElement('div')
    host.innerHTML = `<div class="pull ${state}" style="--at: 40px"><svg><circle class="track"></circle><circle class="filling"></circle><path class="arrow"></path></svg></div>`
    document.body.append(host)
    const mark = host.querySelector('.pull')
    if (!mark) throw new Error('no mark')
    expect(easing(mark, mark)).toEqual([])
    host.remove()
  })
})
