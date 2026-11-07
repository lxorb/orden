const AT_ONCE = 40_000

const PIECE = 6_000

const AT_A_STEP = 2

type Later = (run: () => void) => () => void

const soon: Later = (run) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const frame = requestAnimationFrame(() => (timer = setTimeout(run, 0)))
  return () => {
    cancelAnimationFrame(frame)
    clearTimeout(timer)
  }
}

interface Drawing {
  node: HTMLElement
  pieces: Node[][]
  next: number
  box?: Element | null
}

interface Turn {
  drawings: Set<Drawing>
  stop: (() => void) | null
}

const turns = new Map<Later, Turn>()

function scrollerOf(node: Element): Element | null {
  for (let at = node.parentElement; at; at = at.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at
  }
  return null
}

function piecesOf(nodes: readonly Node[], most = PIECE): Node[][] {
  const pieces: Node[][] = []
  let piece: Node[] = []
  let size = 0
  for (let at = nodes.length - 1; at >= 0; at--) {
    const one = nodes[at]
    if (!one) continue
    piece.unshift(one)
    size += (one.textContent?.length ?? 0) + 1
    if (size >= most) {
      pieces.push(piece)
      piece = []
      size = 0
    }
  }
  if (piece.length) pieces.push(piece)
  return pieces
}

function step(drawings: readonly Drawing[]): void {
  for (const one of drawings) one.box ??= scrollerOf(one.node)
  const boxes = new Map<Element, { below: number; above: Drawing[]; rest: number }>()
  const tall = new Map<Drawing, number>()
  for (const one of drawings) {
    const { box } = one
    if (!box) continue
    const held = boxes.get(box) ?? { below: box.scrollHeight - box.scrollTop, above: [], rest: 0 }
    boxes.set(box, held)
    const rect = one.node.getBoundingClientRect()
    if (rect.top < box.getBoundingClientRect().top) {
      held.above.push(one)
      tall.set(one, rect.height)
    } else held.rest++
  }
  for (const one of drawings) one.node.prepend(...(one.pieces[one.next++] ?? []))
  for (const [box, { below, above, rest }] of boxes) {
    if (!above.length) continue
    if (!rest) {
      box.scrollTop = box.scrollHeight - below
      continue
    }
    const grew = above.reduce(
      (sum, one) => sum + one.node.getBoundingClientRect().height - (tall.get(one) ?? 0),
      0,
    )
    box.scrollTop += grew
  }
}

function schedule(later: Later): void {
  const turn = turns.get(later)
  if (!turn || turn.stop) return
  turn.stop = later(() => {
    turn.stop = null
    const now = [...turn.drawings].slice(0, AT_A_STEP)
    step(now)
    for (const one of now) {
      turn.drawings.delete(one)
      if (one.next < one.pieces.length) turn.drawings.add(one)
    }
    if (turn.drawings.size) schedule(later)
    else turns.delete(later)
  })
}

export function drawInPieces(node: HTMLElement, html: string, later: Later = soon): () => void {
  if (html.length <= AT_ONCE) {
    node.innerHTML = html
    return () => undefined
  }
  const sheet = document.createElement('template')
  sheet.innerHTML = html
  const pieces = piecesOf([...sheet.content.childNodes])
  node.replaceChildren(...(pieces[0] ?? []))
  if (pieces.length < 2) return () => undefined
  const drawing: Drawing = { node, pieces, next: 1 }
  const turn = turns.get(later) ?? { drawings: new Set<Drawing>(), stop: null }
  turns.set(later, turn)
  turn.drawings.add(drawing)
  schedule(later)
  return () => {
    turn.drawings.delete(drawing)
    if (turn.drawings.size || !turn.stop) return
    turn.stop()
    turn.stop = null
    turns.delete(later)
  }
}
