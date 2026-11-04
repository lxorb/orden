/** A part a component fetches for itself, answered only while the component is there.
 *
 *  A component fetches what it rarely needs when it is first asked for - a menu's rows,
 *  the chip a carried tab is drawn as, the hover card - with `import()`. The fetch takes
 *  as long as it takes, and the component may be gone by the time it lands: a strip
 *  taken down with its pane, a window closed, a test over. What came back then used to
 *  act anyway, showing a menu for a strip that is not there or setting state on a torn
 *  down component, and a fetch that failed once nobody was waiting for it was an
 *  unhandled rejection - which is how a test ending while a tab's carrying code was on
 *  its way failed the run it was in (`tab-strip-gestures.effect.test.ts`).
 *
 *  So a component wraps each fetch in what `whileHere` gives it, called while it is
 *  being set up: the answer reaches it while it is mounted, and after that it is
 *  dropped, success and failure alike, and nothing runs. */

import { onDestroy } from 'svelte'

/** For the component being set up: wraps a fetch so its answer is heard only while the
 *  component is mounted. A failure while it is mounted is the caller's, as before. */
export function whileHere(): <T>(asked: Promise<T>) => Promise<T> {
  let here = true
  onDestroy(() => {
    here = false
  })

  return <T>(asked: Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      asked.then(
        (value) => {
          if (here) resolve(value)
        },
        (error: unknown) => {
          if (here) reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })
}
