/** A window dragged on the overview's canvas (issue #331): what makes a press a drag,
 *  and where letting it go takes its tab. Where the window itself lies is free.ts. */

/** Where a dragged tab goes when it is let go: into a pane's strip, before a tab of it
 *  or at its end; or, in All spaces, into another space's cell (cells.ts). Never a pane
 *  of its own: a split made by a drag on this canvas happened too easily, so the
 *  overview makes none (Emil, 2026-11-04). */
export type Landing =
  { kind: 'strip'; paneId: string; before: string | null } | { kind: 'space'; key: string }

/** Whether the pointer has gone far enough from where it was pressed to be a drag
 *  rather than a press. */
export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > 5
}
