import { workDone as firmwareWork } from '../src/firmware'
import { type Paging, workDone as pagingWork } from '../src/pages'
import { BODY_INNER, BODY_ROWS, GUTTER } from '../src/panel'

export const NOTE = Array.from(
  { length: 160 },
  (_one, at) =>
    `## Section ${at}\n\nProse about section ${at}, long enough to wrap across the panel more than once and then some.\n\n- a point\n- another point\n\n`,
).join('')

export const PAGING: Paging = {
  breakAt: 2,
  gutter: GUTTER,
  inner: BODY_INNER,
  rows: BODY_ROWS,
}

export function typed(round: number, mark = ''): string {
  return NOTE.replace(
    'Prose about section 7,',
    `Prose about section ${mark}${String(round).padStart(4, '0')},`,
  )
}

export function costOf(work: () => unknown): {
  set: ReturnType<typeof firmwareWork>
  paged: ReturnType<typeof pagingWork>
} {
  firmwareWork()
  pagingWork()
  work()
  return { set: firmwareWork(), paged: pagingWork() }
}
