import { listIn, LONGEST_PATH, staysInside } from '../../../sync-server/src/api'
import { columnRoute } from './space'

const MOST = 200

function inside(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= LONGEST_PATH && staysInside(path)
}

function wrong(value: unknown): string | null {
  if (!Array.isArray(value)) return 'excluded must be a list'
  if (value.length > MOST) return `a space leaves out at most ${MOST} paths`
  return null
}

function pathsOf(value: readonly unknown[]): string[] {
  const out: string[] = []

  for (const one of value) {
    if (out.length >= MOST) break
    if (inside(one) && !out.includes(one)) out.push(one)
  }

  return out
}

export function readExcluded(raw: string): string[] {
  const held = listIn(raw)
  return held ? pathsOf(held) : []
}

export const spaceExcluded = columnRoute('excluded', wrong, pathsOf, 'that is more paths than a space leaves out')
