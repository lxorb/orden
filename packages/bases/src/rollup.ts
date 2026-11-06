export const ROLLUPS = [
  'count',
  'filled',
  'unique',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
  'checked',
  'percent',
] as const
export type Rollup = (typeof ROLLUPS)[number]

export interface RollupSpec {
  relation: string
  property?: string
  calc: Rollup
}

const NAME = /^[A-Za-z_][\w]*$/

function member(object: string, key: string): string {
  return NAME.test(key) ? `${object}.${key}` : `${object}[${JSON.stringify(key)}]`
}

function columnOf(column: string): string {
  if (column.startsWith('formula.')) return member('formula', column.slice(8))
  return member('note', column.replace(/^note\./, ''))
}

const OF_NOTES: readonly Rollup[] = ['count']

export function rollupFormula(spec: RollupSpec): string {
  const notes = `list(${columnOf(spec.relation)})`
  if (OF_NOTES.includes(spec.calc) || spec.property === undefined) return `${notes}.length`

  const values = `${notes}.map(${member('value.asFile().properties', spec.property)})`
  const numbers = `${values}.filter(value.isType("number"))`
  const present = `${values}.filter(value != null && value != "")`
  const total = `${numbers}.reduce(acc + value, 0)`
  switch (spec.calc) {
    case 'filled':
      return `${present}.length`
    case 'unique':
      return `${present}.unique().length`
    case 'sum':
      return total
    case 'average':
      return `if(${numbers}.length, ${total} / ${numbers}.length, null)`
    case 'median':
      return `if(${numbers}.length, (${numbers}.sort()[((${numbers}.length - 1) / 2).floor()] + ${numbers}.sort()[(${numbers}.length / 2).floor()]) / 2, null)`
    case 'min':
      return `${present}.sort()[0]`
    case 'max':
      return `${present}.sort().reverse()[0]`
    case 'range':
      return `${present}.sort().reverse()[0] - ${present}.sort()[0]`
    case 'checked':
      return `${values}.filter(value == true).length`
    case 'percent':
      return `if(${values}.length, ${values}.filter(value == true).length / ${values}.length, 0)`
    case 'count':
      return `${notes}.length`
  }
}

const SHAPE =
  /^list\((note|formula)(?:\.([A-Za-z_]\w*)|\[("(?:[^"\\]|\\.)*")\])\)(?:\.map\(value\.asFile\(\)\.properties(?:\.([A-Za-z_]\w*)|\[("(?:[^"\\]|\\.)*")\])\))?/

export function readRollup(formula: string): RollupSpec | null {
  const found = SHAPE.exec(formula.replace(/^if\(/, '').trim())
  if (!found) return null
  const key = found[2] ?? (found[3] === undefined ? '' : String(JSON.parse(found[3])))
  const relation = `${found[1]}.${key}`
  const property = found[4] ?? (found[5] === undefined ? undefined : String(JSON.parse(found[5])))
  const trimmed = formula.trim()
  for (const calc of ROLLUPS) {
    const spec: RollupSpec =
      property === undefined ? { relation, calc } : { relation, property, calc }
    if (rollupFormula(spec) === trimmed) return spec
  }
  return null
}

export function reverseFormula(property: string): string {
  const key = property.replace(/^note\./, '')
  return `file.backlinks.filter(list(${member('value.asFile().properties', key)}).contains(file))`
}

const REVERSE =
  /^file\.backlinks\.filter\(list\(value\.asFile\(\)\.properties(?:\.([A-Za-z_]\w*)|\[("(?:[^"\\]|\\.)*")\])\)\.contains\(file\)\)$/

export function readReverse(formula: string): string | null {
  const found = REVERSE.exec(formula.trim())
  if (!found) return null
  return found[1] ?? (found[2] === undefined ? null : String(JSON.parse(found[2])))
}
