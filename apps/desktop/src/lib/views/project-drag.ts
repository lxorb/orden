/** A project row carried up or down the Tasks panel, Todoist's drag to reorder: past a
 *  few pixels with a mouse or a pen the row is lifted, the row
 *  under it shows a line above or below where it would land, and letting go places it
 *  there (`placeProject`). Escape puts it back. The press that ends a drag opens nothing.
 *
 *  A Svelte action on each project row, which says what it carries:
 *
 *      <div use:projectDrag={{ id: node.note, place }}>
 *
 *  The rows it can land on are the ones wearing `data-project`. Under a finger a held
 *  row is its menu, as everywhere in the panel, and the order is the file list's to
 *  change there. */

/** How far a pointer travels before it is a drag. */
const SLOP = 6

export interface ProjectCarry {
  /** The project's note, which `data-project` names it by. */
  id: string
  place: (moving: string, target: string, after: boolean) => void
}

/** Which half of a row a point is over: below the middle lands after it. */
export function landsAfter(y: number, top: number, height: number): boolean {
  return y > top + height / 2
}

export function projectDrag(node: HTMLElement, start: ProjectCarry) {
  let carry = start
  let from: { x: number; y: number } | null = null
  let lifted = false
  let over: { row: HTMLElement; after: boolean } | null = null

  const mark = (next: typeof over) => {
    over?.row.classList.remove('is-above', 'is-below')
    over = next
    over?.row.classList.add(over.after ? 'is-below' : 'is-above')
  }

  const lift = () => {
    lifted = true
    node.classList.add('is-carried')
  }

  const move = (event: PointerEvent) => {
    if (!from) return
    if (!lifted) {
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) < SLOP) return
      lift()
    }
    event.preventDefault()
    const row = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-project]')
    if (!row || row === node) {
      mark(null)
      return
    }
    const box = row.getBoundingClientRect()
    const after = landsAfter(event.clientY, box.top, box.height)
    if (over?.row !== row || over.after !== after) mark({ row, after })
  }

  const swallow = (event: Event) => {
    event.stopPropagation()
    event.preventDefault()
  }

  const end = (drop: boolean) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', key, true)
    const was = lifted
    const target = over
    mark(null)
    lifted = false
    from = null
    node.classList.remove('is-carried')
    if (!was) return
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    const id = target?.row.dataset.project
    if (drop && target && id) carry.place(carry.id, id, target.after)
  }

  const up = () => end(true)
  const cancel = () => end(false)
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    end(false)
  }

  const down = (event: PointerEvent) => {
    if (event.button !== 0 || event.pointerType === 'touch') return
    if (event.target instanceof Element && event.target.closest('input, .twist')) return
    from = { x: event.clientX, y: event.clientY }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
  }

  node.addEventListener('pointerdown', down)
  return {
    update(next: ProjectCarry) {
      carry = next
    },
    destroy() {
      end(false)
      node.removeEventListener('pointerdown', down)
    },
  }
}
