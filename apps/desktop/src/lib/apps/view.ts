/** The holder's view of an application, as its host is told it (issue 1063, step 5;
 *  `View` in `@orden/online/apps`): the pane's size and pixel ratio, which the
 *  application's display is made to, and the refresh rate of the screen the tab is on,
 *  which its picture is read at. */

/** How long a view has to stay the same before it is said: an edge of the pane dragged
 *  is said once, where it is let go, rather than for every step of the drag. */
export const SETTLE = 150

/** The refresh rate of the screen a tab is on, from the times between frames it drew,
 *  in milliseconds: the middle one's, rounded; null for too few, or for gaps no screen
 *  draws at (a window hidden, its frames held back). */
export function refreshRate(gaps: readonly number[]): number | null {
  if (gaps.length < 8) return null
  const sorted = [...gaps].sort((one, other) => one - other)
  const middle = sorted[Math.floor(sorted.length / 2)] ?? 0
  if (middle <= 0) return null
  const hz = Math.round(1000 / middle)
  return hz >= 24 && hz <= 500 ? hz : null
}

/** What is said once it has settled: the last of what was seen, `SETTLE` after it. */
export class Settling<T> {
  private cancel: (() => void) | null = null

  constructor(
    private readonly say: (value: T) => void,
    private readonly after: (ms: number, run: () => void) => () => void,
  ) {}

  saw(value: T): void {
    this.cancel?.()
    this.cancel = this.after(SETTLE, () => {
      this.cancel = null
      this.say(value)
    })
  }

  end(): void {
    this.cancel?.()
    this.cancel = null
  }
}
