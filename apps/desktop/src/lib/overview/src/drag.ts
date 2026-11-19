export type Landing = { kind: 'strip'; paneId: string; before: string | null } | { kind: 'space'; key: string }

export const isDrag = (dx: number, dy: number): boolean => Math.hypot(dx, dy) > 5
