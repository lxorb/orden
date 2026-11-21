import { changed, type Face, type Look } from './faces'

export const IDLE = { least: 1800, most: 5000 } as const
export function animate(look: Look, show: (face: Face) => void, random: () => number = Math.random): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const later = (ms: number, then: () => void) => {
    timer = setTimeout(then, ms)
  }
  const idle = () => later(IDLE.least + random() * (IDLE.most - IDLE.least), move)
  const move = () => {
    const frames = look.moves[Math.min(look.moves.length - 1, Math.floor(random() * look.moves.length))]
    if (!frames) return
    const step = (at: number) => {
      const frame = frames[at]
      if (!frame) {
        show(look.rest)
        idle()
        return
      }
      show(changed(look.rest, frame.change))
      later(frame.ms, () => step(at + 1))
    }
    step(0)
  }
  show(look.rest)
  idle()
  return () => clearTimeout(timer)
}
