import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseSync, Visitor } from 'vite'

function parsed(code: string, lang: 'js' | 'ts') {
  const { program, errors } = parseSync(`code.${lang}`, code, { lang })
  if (errors.length) throw new Error(errors.map((one) => one.message).join('\n'))

  return program
}

export function stringsIn(code: string, lang: 'js' | 'ts' = 'js'): Set<string> {
  const found = new Set<string>()
  const named = new Set<unknown>()

  new Visitor({
    MemberExpression(node) {
      if (node.computed) named.add(node.property)
    },
    Literal(node) {
      if (typeof node.value === 'string' && !named.has(node)) found.add(node.value)
    },
    TemplateLiteral(node) {
      const [only, ...more] = node.quasis
      if (only?.value.cooked != null && !more.length) found.add(only.value.cooked)
    },
  }).visit(parsed(code, lang))

  return found
}

export function serverWords(): Set<string> {
  const found = new Set<string>()
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        for (const one of stringsIn(readFileSync(path, 'utf8'), 'ts')) found.add(one)
      }
    }
  }

  walk(resolve(import.meta.dirname, '../../services/sync/src'))
  return found
}

function tableIn(code: string, lang: 'js' | 'ts') {
  const tables = parsed(code, lang).body.flatMap((statement) => {
    const declared = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declared?.type !== 'VariableDeclaration') return []

    return declared.declarations.flatMap(({ init }) => {
      if (init?.type === 'ObjectExpression') return [init]
      const [only, ...more] = init?.type === 'CallExpression' ? init.arguments : []
      return only?.type === 'ObjectExpression' && !more.length ? [only] : []
    })
  })
  const [table, ...more] = tables
  if (!table || more.length) throw new Error(`a catalogue is one table, not ${tables.length}`)

  const rows = table.properties.map((row) => {
    if (row.type === 'Property' && !row.computed) {
      const { key } = row
      const english =
        key.type === 'Identifier'
          ? key.name
          : key.type === 'Literal' && typeof key.value === 'string'
            ? key.value
            : null
      if (english !== null) return { english, text: code.slice(row.value.start, row.value.end) }
    }
    throw new Error('a catalogue row is `English: text`')
  })

  return { start: table.start, end: table.end, rows }
}

export function englishIn(code: string): string[] {
  return tableIn(code, 'js').rows.map((row) => row.english)
}

export function handedTo(code: string, helper: string): string {
  const { start, end } = tableIn(code, 'ts')

  return `${code.slice(0, start)}${helper}(${code.slice(start, end)})${code.slice(end)}`
}

export function inColumn(code: string, keys: readonly string[]): string {
  const { start, end, rows } = tableIn(code, 'js')
  const text = new Map(rows.map((row) => [row.english, row.text]))
  const column = keys.map((english) => text.get(english) ?? '').join(',')

  return `${code.slice(0, start)}[${column}]${code.slice(end)}`
}
