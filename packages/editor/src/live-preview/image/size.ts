/** What a corner drag settles on.
 *
 *  A size is kept as a percentage of the picture's own width, which is what
 *  Typora's `style="zoom:N%"` means, so the same note read on a wider screen
 *  shows the same picture at the same size. Pure arithmetic, with no view and no
 *  DOM, which is what lets the snapping be tested for what it is. */

/** Where a drag settles when it comes close: the sizes people mean. */
const SNAP_STOPS = [25, 33, 50, 67, 75, 100]
const SNAP_TOLERANCE = 3
/** Narrower than this and the handles would overlap. */
const MIN_WIDTH = 48

export function snapPercent(percent: number, snap = true): number {
  if (snap) {
    for (const stop of SNAP_STOPS) {
      if (Math.abs(percent - stop) <= SNAP_TOLERANCE) return stop
    }
  }
  return Math.round(percent)
}

/** The zoom a drag asks for: the width it dragged to, as a share of the
 *  natural width, never wider than the picture is or the line allows. */
export function resizeTo(
  startWidth: number,
  delta: number,
  natural: number,
  lineWidth: number,
  snap = true,
): number {
  const max = Math.min(natural, lineWidth)
  const width = Math.min(max, Math.max(Math.min(MIN_WIDTH, max), startWidth + delta))
  return Math.max(1, Math.min(100, snapPercent((width / natural) * 100, snap)))
}
