import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'

/** Every key in storage is read the way it was written (#1095).
 *
 *  A value is kept one of two ways: as the words themselves (`keep`) or as JSON
 *  (`keepJson`), and read back the matching way: `storedText` for words, `stored` for
 *  JSON. Read the other way, it reads as nothing - JSON.parse refuses a bare word - and
 *  nothing says so: the setting simply never comes back. That happened twice, the icon
 *  picker's last tab (#1071) and the AI panel's "Don't ask again" (#1089), each looking
 *  fine in the code that wrote it and in the code that read it.
 *
 *  So this reads the whole app, finds every key each of the four is called with -
 *  through the constants and templates the keys are named by - and holds each key to one
 *  way. A JSON.stringify handed to `keep` is not allowed at all, because then the way a
 *  value is written would be in the value and not in the call. */

const SOURCE = fileURLToPath(new URL('../src', import.meta.url))

type Way = 'text' | 'json'
interface Use {
  way: Way
  side: 'write' | 'read'
  at: string
}

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, found)
    else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts')) found.push(path)
  }
  return found
}

/** A file's script, as TypeScript reads it: a Svelte component's `<script>` blocks. */
function scriptOf(path: string): string {
  const text = readFileSync(path, 'utf8')
  if (!path.endsWith('.svelte')) return text
  return [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((one) => one[1]).join('\n')
}

/** What is wrong with how the keys in `given` are written and read: a JSON.stringify
 *  handed to `keep`, and a key read another way than it is written. */
function audit(given: readonly { name: string; text: string }[]) {
  const sources = given.map(({ name, text }) => ({
    name,
    file: ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true),
  }))

  /** Every module-level `const NAME = ...` in the app, by name, where the name is said once:
   *  what a key's constant is resolved through, across the file that imports it. */
  const constants = new Map<string, ts.Expression[]>()
  const local = new Map<string, Map<string, ts.Expression>>()
  for (const { name, file } of sources) {
    const own = new Map<string, ts.Expression>()
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const one of statement.declarationList.declarations) {
        if (!ts.isIdentifier(one.name) || !one.initializer) continue
        own.set(one.name.text, one.initializer)
        constants.set(one.name.text, [...(constants.get(one.name.text) ?? []), one.initializer])
      }
    }
    local.set(name, own)
  }

  /** A key as it is in storage: a string, with `*` for any part made at run time. Null
   *  where it cannot be told from the source, which is then named by its expression in
   *  that file. */
  function keyOf(node: ts.Expression, file: string, depth = 0): string | null {
    if (depth > 6) return null
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
      return keyOf(node.expression, file, depth + 1)
    if (ts.isTemplateExpression(node)) {
      let out = node.head.text
      for (const span of node.templateSpans) {
        out += keyOf(span.expression, file, depth + 1) ?? '*'
        out += span.literal.text
      }
      return out
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return (
        (keyOf(node.left, file, depth + 1) ?? '*') + (keyOf(node.right, file, depth + 1) ?? '*')
      )
    }
    if (ts.isIdentifier(node)) {
      const here = local.get(file)?.get(node.text)
      if (here) return keyOf(here, file, depth + 1)
      const there = constants.get(node.text)
      if (there?.length === 1 && there[0]) return keyOf(there[0], file, depth + 1)
    }
    return null
  }

  const called = (node: ts.CallExpression, name: string) =>
    (ts.isIdentifier(node.expression) && node.expression.text === name) ||
    (ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === name &&
      node.expression.expression.getText() !== 'this')

  const equality = [
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ]

  /** Whether a read is held only to be compared later, as it is: `const held =
   *  storedText(KEY)`, then `storedText(KEY) === held` after an await. */
  function onlyCompared(read: ts.CallExpression): boolean {
    const held = read.parent
    if (!ts.isVariableDeclaration(held) || !ts.isIdentifier(held.name)) return false
    const name = held.name.text
    let scope: ts.Node = held
    while (!ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent
    let only = true
    const look = (node: ts.Node) => {
      if (ts.isIdentifier(node) && node.text === name && node !== held.name) {
        const parent = node.parent
        if (!ts.isBinaryExpression(parent) || !equality.includes(parent.operatorToken.kind))
          only = false
      }
      ts.forEachChild(node, look)
    }
    look(scope)
    return only
  }

  const uses = new Map<string, Use[]>()
  const stringified: string[] = []

  for (const { name, file } of sources) {
    const add = (key: ts.Expression | undefined, way: Way, side: Use['side'], node: ts.Node) => {
      if (!key) return
      const at = `${name}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
      // A key that says nothing of its own - a parameter, `${prefix}${id}` with neither
      // known - is the helper's, named by its expression in its file.
      const known = keyOf(key, name)
      const said =
        known !== null && /[\w.:-]{3,}/.test(known.replace(/\*/g, ''))
          ? known
          : `${name}#${key.getText()}`
      uses.set(said, [...(uses.get(said) ?? []), { way, side, at }])
    }
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && name !== 'lib/stored.ts') {
        const [key, value] = node.arguments
        const parent = node.parent
        // A read whose words are parsed straight away is a JSON read.
        const parsedAfter =
          ts.isCallExpression(parent) &&
          (parent.expression.getText() === 'parsed' || parent.expression.getText() === 'JSON.parse')
        if (ts.isIdentifier(node.expression) && node.expression.text === 'keep' && key) {
          if (
            value &&
            ts.isCallExpression(value) &&
            value.expression.getText() === 'JSON.stringify'
          )
            stringified.push(
              `${name}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`,
            )
          add(key, 'text', 'write', node)
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'keepJson') {
          add(key, 'json', 'write', node)
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'stored') {
          add(key, 'json', 'read', node)
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'storedText') {
          // Compared as it is, the text says nothing of how it is read: whether what this
          // run wrote is still there.
          const compared =
            ts.isBinaryExpression(parent) &&
            [
              ts.SyntaxKind.EqualsEqualsEqualsToken,
              ts.SyntaxKind.ExclamationEqualsEqualsToken,
            ].includes(parent.operatorToken.kind)
          if (!compared && !onlyCompared(node))
            add(key, parsedAfter ? 'json' : 'text', 'read', node)
        } else if (called(node, 'getItem') && node.expression.getText().includes('Storage')) {
          add(key, parsedAfter ? 'json' : 'text', 'read', node)
        } else if (called(node, 'setItem') && node.expression.getText().includes('Storage')) {
          const json =
            value && ts.isCallExpression(value) && value.expression.getText() === 'JSON.stringify'
          add(key, json ? 'json' : 'text', 'write', node)
        }
      }
      // `Shared` reads JSON and is written JSON; see stored.ts.
      if (ts.isNewExpression(node) && node.expression.getText() === 'Shared') {
        add(node.arguments?.[0], 'json', 'read', node)
        add(node.arguments?.[0], 'json', 'write', node)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }

  /** A key made at run time stands for every key it could be. */
  const matches = (pattern: string, key: string) =>
    pattern === key ||
    (pattern.includes('*') &&
      new RegExp(
        `^${pattern
          .split('*')
          .map((one) => one.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      ).test(key))

  const wrong: string[] = []
  const keys = [...uses.keys()]
  for (const key of keys) {
    const related = keys.filter((other) => matches(key, other) || matches(other, key))
    const all = related.flatMap((one) => uses.get(one) ?? [])
    const writes = new Set(all.filter((one) => one.side === 'write').map((one) => one.way))
    const reads = all.filter((one) => one.side === 'read')
    for (const read of reads) {
      if (writes.size && !writes.has(read.way))
        wrong.push(`${key}: read as ${read.way} at ${read.at}, written as ${[...writes].join('/')}`)
    }
    if (writes.size > 1)
      wrong.push(
        `${key}: written both ways (${all
          .filter((one) => one.side === 'write')
          .map((one) => `${one.way} ${one.at}`)
          .join(', ')})`,
      )
  }
  return { count: uses.size, stringified, wrong: [...new Set(wrong)].sort() }
}

const app = audit(
  files(SOURCE).map((path) => ({ name: path.slice(SOURCE.length + 1), text: scriptOf(path) })),
)

describe('every key in storage', () => {
  test('is found where it is used', () => {
    expect(app.count).toBeGreaterThan(80)
  })

  test('is written as words or as JSON in the call, never as JSON handed to keep', () => {
    expect(app.stringified).toEqual([])
  })

  test('is read the way it is written', () => {
    expect(app.wrong).toEqual([])
  })
})

/** And the check catches the two it was written for, so a change to it that stopped
 *  seeing them would say so. */
describe('the check itself', () => {
  test('finds a word read as JSON, through the constant that names it', () => {
    const found = audit([
      { name: 'keys.ts', text: "export const SET_KEY = 'nib:icon-set'" },
      { name: 'a.ts', text: "import { SET_KEY } from './keys'\nkeep(SET_KEY, set)" },
      { name: 'b.ts', text: "import { SET_KEY } from './keys'\nconst said = stored(SET_KEY)" },
    ])
    expect(found.wrong).toEqual(['nib:icon-set: read as json at b.ts:2, written as text'])
  })

  test('finds JSON handed to keep, and lets the two right pairs be', () => {
    const found = audit([
      {
        name: 'a.ts',
        text: [
          "const ASKS = 'nib:ai-switch-asks'",
          'keep(ASKS, JSON.stringify(true))',
          "keep('nib:word', 'yes')",
          "storedText('nib:word')",
          'keepJson(`nib:list:${id}`, [1])',
          'stored(`nib:list:${other}`)',
        ].join('\n'),
      },
    ])
    expect(found.stringified).toEqual(['a.ts:2'])
    expect(found.wrong).toEqual([])
  })
})
