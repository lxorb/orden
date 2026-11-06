const SNAP_STOPS = [25, 33, 50, 67, 75, 100]
const SNAP_TOLERANCE = 3
const MIN_WIDTH = 48

export function snapPercent(percent: number, snap = true): number {
  if (snap) {
    for (const stop of SNAP_STOPS) {
      if (Math.abs(percent - stop) <= SNAP_TOLERANCE) return stop
    }
  }
  return Math.round(percent)
}

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
