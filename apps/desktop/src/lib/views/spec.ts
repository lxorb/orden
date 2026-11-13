import { isRecord, isString, parsed } from '../stored'

const BUILTINS = ['todos', 'inbox', 'today', 'upcoming', 'logbook', 'label'] as const
export type Builtin = (typeof BUILTINS)[number]

export interface ViewSpec {
  builtin?: Builtin
  space?: string
  path?: string
  tag?: string
  view?: string
  yaml?: string
}

const isBuiltin = (value: unknown): value is Builtin => BUILTINS.some((one) => one === value)

export function readSpec(words: string): ViewSpec | null {
  const value = parsed(words)
  if (!isRecord(value)) return null

  const spec: ViewSpec = {}
  if (isBuiltin(value.builtin)) spec.builtin = value.builtin
  for (const key of ['space', 'path', 'tag', 'view', 'yaml'] as const) {
    const one = value[key]
    if (isString(one)) spec[key] = one
  }
  return spec
}

export function writeSpec(spec: ViewSpec): string {
  const ordered: ViewSpec = {}
  if (spec.builtin) ordered.builtin = spec.builtin
  if (spec.space !== undefined) ordered.space = spec.space
  if (spec.path !== undefined) ordered.path = spec.path
  if (spec.tag !== undefined) ordered.tag = spec.tag
  if (spec.view !== undefined) ordered.view = spec.view
  if (spec.yaml !== undefined) ordered.yaml = spec.yaml
  return JSON.stringify(ordered)
}

export function sameView(a: ViewSpec, b: ViewSpec): boolean {
  return (
    a.builtin === b.builtin &&
    a.space === b.space &&
    a.path === b.path &&
    a.tag === b.tag &&
    (a.builtin !== undefined || a.view === b.view)
  )
}

export function asShipped(spec: ViewSpec): ViewSpec {
  const out: ViewSpec = {}
  if (spec.builtin) out.builtin = spec.builtin
  if (spec.space !== undefined) out.space = spec.space
  if (spec.path !== undefined) out.path = spec.path
  if (spec.tag !== undefined) out.tag = spec.tag
  return out
}
