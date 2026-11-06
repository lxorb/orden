export const PANEL_WIDTH = 576
export const PANEL_HEIGHT = 288

export const LINE = 27

const MARGIN = 8

export const BODY_ROWS = 8

const NUMS_WIDTH = 48
const NUMS_GAP = 6

export const GUTTER = NUMS_WIDTH + NUMS_GAP

export interface Band {
  x: number
  y: number
  width: number
  height: number
}

export type BandName = 'head' | 'mic' | 'rule' | 'nums' | 'body'

export function bandsOf(lineNumbers: boolean): Record<BandName, Band> {
  const rows = BODY_ROWS * LINE

  return {
    head: { x: MARGIN, y: 2, width: PANEL_WIDTH - MARGIN - 42, height: LINE },
    mic: { x: PANEL_WIDTH - 34, y: 2, width: 26, height: LINE },
    rule: { x: MARGIN, y: 29, width: PANEL_WIDTH - 2 * MARGIN, height: LINE },
    nums: { x: MARGIN, y: 56, width: lineNumbers ? NUMS_WIDTH : 0, height: rows },
    body: { x: MARGIN, y: 56, width: PANEL_WIDTH - 2 * MARGIN, height: rows },
  }
}

export const BODY_INNER = PANEL_WIDTH - 2 * MARGIN

export const HEAD_INNER = PANEL_WIDTH - MARGIN - 42

export const BRIGHT: Record<BandName, number> = {
  head: 4,
  mic: 3,
  rule: 2,
  nums: 2,
  body: 4,
}
