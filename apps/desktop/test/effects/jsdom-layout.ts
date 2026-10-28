import { afterEach } from 'vitest'

/** jsdom lays nothing out and has no `ResizeObserver`, so anything that watches an
 *  element's size - the app's own scrollbar, the palette's whole rows - threw the
 *  moment a test mounted it, and only the files that stubbed it for themselves were
 *  safe (#775). Every effect test gets an observer that never reports, which is what
 *  a page that never moves would see. A file that wants its own still sets one. */
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

/** What a stand-in animation still has to finish, by the call that finishes it. */
const unfinished = new Set<() => void>()

/** Svelte plays every transition through the Web Animations API, which jsdom does not
 *  implement. This one is over a task after it is asked for, long enough for a test to
 *  see a transition under way, and never later than the test that started it.
 *
 *  It used to be a copy in each file that needed one, finishing on a timer, and the
 *  timer is Node's: one an outro started as the file's last test tore its component down
 *  could run after the file's jsdom had gone, when the `CustomEvent` Svelte builds for
 *  `outroend` is Node's own and the jsdom element refuses it ("parameter 1 is not of type
 *  'Event'"). Under load, in a full run and never alone (#446). So what is unfinished
 *  when a test ends finishes then, while its document is still the one it had. A file
 *  that wants an animation of another kind still sets its own. */
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

/** How many rounds a test's end finishes: Svelte plays an outro with a delay as two
 *  animations, the second started by the first one's end. Far past any real chain. */
const ROUNDS = 20

afterEach(() => {
  for (let round = 0; round < ROUNDS && unfinished.size; round++) {
    for (const finish of [...unfinished]) finish()
  }
})
