const AT_ONCE = 40_000

const PIECE = 6_000

type Later = (run: () => void) => () => void

const soon: Later = (run) => {
  const timer = setTimeout(run, 0)
  return () => clearTimeout(timer)
}

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

export function drawInPieces(node: HTMLElement, html: string, later: Later = soon): () => void {
  if (html.length <= AT_ONCE) {
    node.innerHTML = html
    return () => undefined
  }
  const sheet = document.createElement('template')
  sheet.innerHTML = html
  const pieces = piecesOf([...sheet.content.childNodes])
  node.replaceChildren(...(pieces[0] ?? []))
  let next = 1
  let box: Element | null | undefined
  let stop = () => undefined as unknown
  const step = () => {
    const piece = pieces[next++]
    if (!piece) return
    box ??= scrollerOf(node)
    const above = !!box && node.getBoundingClientRect().top < box.getBoundingClientRect().top
    const below = box ? box.scrollHeight - box.scrollTop : 0
    node.prepend(...piece)
    if (box && above) box.scrollTop = box.scrollHeight - below
    if (next < pieces.length) stop = later(step)
  }
  stop = later(step)
  return () => void stop()
}
