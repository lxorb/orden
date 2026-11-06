import { steppedKey } from './direction'
import { focusEditor } from './focus'
import { chorded } from './keys'
import { spelled, type Spelling } from './list-keys'
import { overlays } from './overlays'
import { walked } from './walk'

interface LongList {
  count: () => number
  indexOf: (row: HTMLElement) => number
  labels: () => string[]
  reach: (index: number) => Promise<HTMLElement | null>
}

export interface RovingOptions {
  inner?: boolean
  across?: boolean
  rows?: string
  current?: string
  wrap?: boolean
  keyOf?: (event: KeyboardEvent) => string | null
  label?: (row: HTMLElement) => string
  sideways?: (key: string, row: HTMLElement) => boolean
  open?: (row: HTMLElement) => void
  peek?: (row: HTMLElement) => void
  remove?: (row: HTMLElement) => void
  menu?: (row: HTMLElement, at: MouseEvent) => void
  leave?: () => boolean
  follow?: (row: HTMLElement) => void
  quiet?: string
  long?: LongList
  held?: boolean
}

const DOWN: Record<string, string> = {
  ArrowDown: 'ArrowDown',
  ArrowUp: 'ArrowUp',
  Home: 'Home',
  End: 'End',
}

const ACROSS: Record<string, string> = {
  ArrowRight: 'ArrowDown',
  ArrowLeft: 'ArrowUp',
  Home: 'Home',
  End: 'End',
}

const ENDS = new Set(['Home', 'End'])

const HELD = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'])

export function roving(node: HTMLElement, options: RovingOptions = {}) {
  if (options.inner) return {}

  let settings = options
  let spelling: Spelling = { typed: '', typedAt: 0 }

  const rowsSelector = () => settings.rows ?? '.nib-row'
  const currentSelector = () =>
    settings.current ?? '.is-on, .is-picked, .active, [aria-current=true]'

  const rowsOf = (): HTMLElement[] => [...node.querySelectorAll<HTMLElement>(rowsSelector())]

  const labelOf = (row: HTMLElement) => (settings.label ? settings.label(row) : row.textContent)

  const naming = (row: HTMLElement) => row.querySelector('input, textarea') !== null

  function apply() {
    const rows = rowsOf()
    if (!rows.length) return

    const standing = rows.filter((row) => !naming(row))
    const holding = standing.find((row) => row.contains(document.activeElement))
    const stop =
      holding ?? standing.find((row) => row.matches(currentSelector())) ?? standing[0] ?? null

    for (const row of rows) {
      if (naming(row)) row.removeAttribute('tabindex')
      else row.tabIndex = row === stop ? 0 : -1
    }

    if (settings.quiet) {
      for (const one of node.querySelectorAll<HTMLElement>(settings.quiet)) one.tabIndex = -1
    }
  }

  function stand(row: HTMLElement) {
    row.tabIndex = 0
    for (const other of rowsOf()) {
      if (other !== row) other.tabIndex = -1
    }

    row.focus()
    row.scrollIntoView({ block: 'nearest' })
    settings.follow?.(row)
  }

  function rowOf(event: Event): HTMLElement | null {
    const from = event.target instanceof Element ? event.target.closest(rowsSelector()) : null
    return from instanceof HTMLElement && node.contains(from) ? from : null
  }

  function onKey(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return
    }

    const bare = !chorded(event) || (settings.held === true && HELD.has(event.key))

    const long = settings.long
    const rows = rowsOf()
    const row = rowOf(event)
    const at = row ? (long ? long.indexOf(row) : rows.indexOf(row)) : -1
    const count = long ? long.count() : rows.length
    const own = bare ? event.key : null
    const pressed = ENDS.has(event.key) ? own : settings.keyOf ? settings.keyOf(event) : own
    const key = pressed === null ? null : steppedKey(pressed)

    const moves = settings.across ? ACROSS : DOWN
    const move = key === null ? undefined : moves[key]

    if (move !== undefined) {
      const moved = walked(move, at < 0 ? null : at, count, settings.wrap ?? false)
      if (moved !== null && went(moved)) event.preventDefault()
      return
    }

    if (row && key !== null && settings.sideways?.(key, row)) {
      event.preventDefault()
      return
    }

    if (!bare) return

    switch (event.key) {
      case 'Enter':
        if (!row) return
        event.preventDefault()
        if (settings.open) settings.open(row)
        else row.click()
        return

      case ' ':
        if (!row) return
        event.preventDefault()
        if (settings.peek) settings.peek(row)
        else if (settings.open) settings.open(row)
        else row.click()
        return

      case 'Delete':
      case 'Backspace':
        if (!row || !settings.remove) return
        event.preventDefault()
        settings.remove(row)
        return

      case 'F10':
      case 'ContextMenu':
        if (!row || !settings.menu) return
        if (event.key === 'F10' && !event.shiftKey) return
        event.preventDefault()
        settings.menu(row, atRow(row))
        return

      case 'Escape':
        if (settings.leave?.()) {
          event.preventDefault()
          return
        }
        if (overlays.depth > 0) return
        event.preventDefault()
        focusEditor()
        return

      default:
        break
    }

    if (event.key.length !== 1) return

    const labels = long ? long.labels() : rows.map(labelOf)
    const next = spelled(spelling, event.key, event.timeStamp, labels)
    spelling = { typed: next.typed, typedAt: next.typedAt }

    if (next.found >= 0 && went(next.found)) event.preventDefault()
  }

  function went(index: number): boolean {
    const long = settings.long
    if (!long) {
      const landed = rowsOf()[index]
      if (!landed) return false

      stand(landed)
      return true
    }

    if (index < 0 || index >= long.count()) return false

    void long.reach(index).then((landed) => {
      if (landed) stand(landed)
    })
    return true
  }

  function onFocusIn() {
    apply()
  }

  const watch = new MutationObserver(() => apply())
  watch.observe(node, { childList: true, subtree: true })

  node.addEventListener('keydown', onKey)
  node.addEventListener('focusin', onFocusIn)
  apply()

  return {
    update(next: RovingOptions) {
      settings = next
      apply()
    },
    destroy() {
      watch.disconnect()
      node.removeEventListener('keydown', onKey)
      node.removeEventListener('focusin', onFocusIn)
    },
  }
}

function atRow(row: HTMLElement): MouseEvent {
  const box = row.getBoundingClientRect()

  return new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: Math.round(box.left + Math.min(box.width / 2, 120)),
    clientY: Math.round(box.bottom),
  })
}
