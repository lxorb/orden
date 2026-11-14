export type Landing =
  { kind: 'strip'; paneId: string; before: string | null } | { kind: 'space'; key: string }

export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > 5
}
