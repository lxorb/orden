import { afterEach } from 'vitest'

class NoLayout {
  observe() {
    // jsdom never moves anything.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

const unfinished = new Set<() => void>()

Element.prototype.animate = function animate() {
  const played = {
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    onfinish: null as (() => void) | null,
  }
  const finish = () => {
    if (!unfinished.delete(finish)) return
    clearTimeout(timer)
    played.onfinish?.()
  }
  const timer = setTimeout(finish, 0)
  unfinished.add(finish)
  return played as unknown as Animation
}

const ROUNDS = 20

afterEach(() => {
  for (let round = 0; round < ROUNDS && unfinished.size; round++) {
    for (const finish of [...unfinished]) finish()
  }
})
