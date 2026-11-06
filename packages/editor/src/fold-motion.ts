import { foldEffect, unfoldEffect } from '@codemirror/language'
import {
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

export interface FoldRange {
  from: number
  to: number
}

interface FoldTarget {
  state: EditorState
  dispatch: (transaction: Transaction) => void
}

interface Shutting {
  ranges: readonly FoldRange[]
  id: number
}

const startShut = StateEffect.define<Shutting>()
const stopShut = StateEffect.define()

const shutting = StateField.define<Shutting | null>({
  create: () => null,

  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(startShut)) return effect.value
      if (effect.is(stopShut)) return null
    }

    return transaction.docChanged ? null : value
  },
})

export function shuttingAt(state: EditorState, from: number, to: number): boolean {
  const now = state.field(shutting, false)
  return !!now?.ranges.some((range) => range.from >= from && range.from <= to)
}

export function shuttingChanged(update: ViewUpdate): boolean {
  return update.startState.field(shutting, false) !== update.state.field(shutting, false)
}

export function stopShutting(view: EditorView): void {
  view.dispatch({ effects: stopShut.of(null) })
}

function movement(view: EditorView): { ms: number; easing: string } {
  const style = getComputedStyle(view.contentDOM)
  const easing = style.getPropertyValue('--ease-in-out').trim()

  return {
    ms: millisecondsIn(style.getPropertyValue('--dur-base')),
    easing: easing || 'ease-in-out',
  }
}

function millisecondsIn(said: string): number {
  const written = said.trim()
  const number = Number.parseFloat(written)
  if (!Number.isFinite(number)) return 0

  return written.endsWith('ms') ? number : number * 1000
}

interface Box {
  height: string
  paddingTop: string
  paddingBottom: string
  borderTopWidth: string
  borderBottomWidth: string
}

const NO_ROOM: Box = {
  height: '0px',
  paddingTop: '0px',
  paddingBottom: '0px',
  borderTopWidth: '0px',
  borderBottomWidth: '0px',
}

function roomOf(el: HTMLElement): Box {
  const style = getComputedStyle(el)

  return {
    height:
      style.boxSizing === 'border-box' ? `${el.getBoundingClientRect().height}px` : style.height,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    borderTopWidth: style.borderTopWidth,
    borderBottomWidth: style.borderBottomWidth,
  }
}

interface Move {
  el: HTMLElement
  room: Box
}

function worthMoving(view: EditorView, range: FoldRange): boolean {
  if (range.to <= range.from) return false
  if (range.from < view.viewport.from || range.to > view.viewport.to) return false

  return view.visibleRanges.some((seen) => range.from >= seen.from && range.from <= seen.to)
}

function blockAt(view: EditorView, pos: number): HTMLElement | null {
  const at = view.domAtPos(pos)
  let node: Node | null =
    at.node === view.contentDOM ? (at.node.childNodes[at.offset] ?? null) : at.node

  while (node && node.parentNode !== view.contentDOM) node = node.parentNode
  return node instanceof HTMLElement ? node : null
}

function boxesOf(view: EditorView, range: FoldRange): Move[] {
  const first = blockAt(view, range.from + 1)
  const moves: Move[] = []

  for (let el: Element | null = first; el instanceof HTMLElement; el = el.nextElementSibling) {
    if (view.posAtDOM(el) > range.to) break
    moves.push({ el, room: roomOf(el) })
  }

  return moves
}

function frame(room: Box, shown: number): Keyframe {
  return { ...room, opacity: String(shown), overflow: 'hidden' }
}

function animate(moves: readonly Move[], out: boolean, ms: number, easing: string): Animation[] {
  return moves.map(({ el, room }) =>
    el.animate(out ? [frame(room, 1), frame(NO_ROOM, 0)] : [frame(NO_ROOM, 0), frame(room, 1)], {
      duration: ms,
      easing,
      fill: out ? 'both' : 'backwards',
    }),
  )
}

const running = ViewPlugin.fromClass(
  class {
    private held: { id: number; animations: Animation[] } | null = null

    update(update: ViewUpdate) {
      const now = update.state.field(shutting, false) ?? null
      if (this.held && now?.id !== this.held.id) this.stop()
    }

    hold(id: number, animations: Animation[]) {
      this.stop()
      this.held = { id, animations }
    }

    stop() {
      for (const one of this.held?.animations ?? []) one.cancel()
      this.held = null
    }

    destroy() {
      this.stop()
    }
  },
)

let counted = 0

export function shutFolds(
  target: FoldTarget,
  ranges: readonly FoldRange[],
  caret: TransactionSpec = {},
): void {
  const view = target instanceof EditorView ? target : null
  const { ms, easing } = view ? movement(view) : { ms: 0, easing: '' }

  const moving = view && ms > 0 ? ranges.filter((range) => worthMoving(view, range)) : []

  if (!view || !moving.length) {
    target.dispatch(
      target.state.update({ effects: ranges.map((range) => foldEffect.of(range)), ...caret }),
    )
    return
  }

  const id = ++counted

  view.dispatch({
    effects: [
      ...(view.state.field(shutting, false)?.ranges ?? []).map((range) => foldEffect.of(range)),
      ...ranges.filter((range) => !moving.includes(range)).map((range) => foldEffect.of(range)),
      startShut.of({ id, ranges: moving }),
    ],
    ...caret,
  })

  const moves = moving.flatMap((range) => boxesOf(view, range))
  const land = (effects: StateEffect<unknown>[]) => view.dispatch({ effects })

  if (!moves.length) {
    land([...moving.map((range) => foldEffect.of(range)), stopShut.of(null)])
    return
  }

  const animations = animate(moves, true, ms, easing)
  view.plugin(running)?.hold(id, animations)

  Promise.all(animations.map((one) => one.finished))
    .then(() => {
      if (view.state.field(shutting, false)?.id !== id) return
      land([...moving.map((range) => foldEffect.of(range)), stopShut.of(null)])
    })
    .catch(() => undefined)
}

export function openFolds(target: FoldTarget, ranges: readonly FoldRange[]): void {
  const called = target.state.field(shutting, false) ? [stopShut.of(null)] : []

  target.dispatch(
    target.state.update({
      effects: [...called, ...ranges.map((range) => unfoldEffect.of(range))],
    }),
  )

  const view = target instanceof EditorView ? target : null
  if (!view) return

  const { ms, easing } = movement(view)
  if (ms <= 0) return

  const moves = ranges
    .filter((range) => worthMoving(view, range))
    .flatMap((range) => boxesOf(view, range))
  if (!moves.length) return

  const animations = animate(moves, false, ms, easing)

  Promise.all(animations.map((one) => one.finished))
    .then(() => view.requestMeasure())
    .catch(() => undefined)
}

export function foldMovement(): Extension {
  return [shutting, running]
}
