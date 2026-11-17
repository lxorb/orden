import { movedTo, samePath, isRecord, isString, stringList } from '../../platform/src/api'

export interface Spec {
  folder: string
  back: string[]
  ahead: string[]
}

const KEPT = 50

export function readSpec(text: string): Spec | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || !isString(value.folder) || !value.folder) return null
  return {
    folder: value.folder,
    back: (stringList(value.back) ?? []).slice(-KEPT),
    ahead: (stringList(value.ahead) ?? []).slice(-KEPT),
  }
}

export function writeSpec(spec: Spec): string {
  return JSON.stringify(spec)
}

export function wentTo(spec: Spec, folder: string): Spec {
  if (samePath(folder, spec.folder)) return spec
  return { folder, back: [...spec.back, spec.folder].slice(-KEPT), ahead: [] }
}

export function steppedBack(spec: Spec): Spec | null {
  const folder = spec.back.at(-1)
  if (folder === undefined) return null
  return { folder, back: spec.back.slice(0, -1), ahead: [...spec.ahead, spec.folder] }
}

export function steppedForward(spec: Spec): Spec | null {
  const folder = spec.ahead.at(-1)
  if (folder === undefined) return null
  return { folder, back: [...spec.back, spec.folder], ahead: spec.ahead.slice(0, -1) }
}

export function specMoved(spec: Spec, from: string, to: string): Spec | null {
  const at = (path: string) => movedTo(path, from, to) ?? path
  const now = { folder: at(spec.folder), back: spec.back.map(at), ahead: spec.ahead.map(at) }
  return writeSpec(now) === writeSpec(spec) ? null : now
}
