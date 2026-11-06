import { afterQuiet } from './timing'

export interface ScrollEnd {
  top(): number
  show(position: number): void
  onScroll(run: () => void): () => void
}

const ECHO = 150

export function linkScroll(a: ScrollEnd, b: ScrollEnd): () => void {
  let leading: ScrollEnd | null = null
  const quiet = afterQuiet(() => (leading = null), ECHO)

  const carry = (from: ScrollEnd, to: ScrollEnd) => () => {
    if (leading && leading !== from) return

    leading = from
    quiet()

    to.show(from.top())
  }

  const stops = [a.onScroll(carry(a, b)), b.onScroll(carry(b, a))]

  return () => {
    quiet.cancel()
    for (const stop of stops) stop()
  }
}
