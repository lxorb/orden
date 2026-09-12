/** A starting catalogue for a language, so nobody writes a thousand rows by hand
 *  from nothing.
 *
 *      node scripts/locale-template.mjs sv nl
 *
 *  Writes `target/locale-templates/<id>.ts`: the same rows in the same order as
 *  `apps/desktop/src/locales/de.ts`, with the same section comments, English
 *  values, and every count row already shaped for the plural forms that language
 *  actually has. Copy it to `apps/desktop/src/locales/<id>.ts`, translate the
 *  values, and leave everything else alone; `src/lib/i18n.test.ts` is what says
 *  whether it is right.
 *
 *  Nothing here reads a list of rows or of plural keys: the German catalogue is
 *  the reference, and a row it holds as forms rather than as one string is a row
 *  a count decides. A list beside it would be a second thing to keep in step. */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\//, '')
const LOCALES = `${ROOT}apps/desktop/src/locales/`
const OUT = `${ROOT}target/locale-templates/`

/** The order the forms are written in, which is how CLDR reads them out. */
const FORM_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other']

/** The reference catalogue, as a list of comments and keys in file order, and as
 *  the object itself. Read as text as well as evaluated because the comments are
 *  half of what makes the file readable and an object has none. */
function reference() {
  const text = readFileSync(`${LOCALES}de.ts`, 'utf8')
  const body = text.slice(text.indexOf('= {') + 3)
  const catalogue = eval(`({${body.slice(0, body.lastIndexOf('}'))}})`)
  const rows = []
  let comments = []

  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('//')) {
      comments.push(trimmed)
      continue
    }

    const found = /^\s{2}(?:'((?:[^'\\]|\\.)*)'|([A-Za-z_$][\w$]*)):/.exec(line)
    if (!found) continue

    const raw = found[1] ?? found[2] ?? ''
    rows.push({
      comments,
      key: raw.replace(/\\(.)/g, (_whole, escaped) => (escaped === 'n' ? '\n' : escaped)),
    })
    comments = []
  }

  return { rows, catalogue }
}

/** The English singular for a count row, read off the call site that asks for it:
 *  `plural(n, { one: '{count} note', other: '{count} notes' })` names both, and
 *  the `other` form is what the row is filed under. */
function singulars() {
  const found = new Map()
  const pattern = /one:\s*'((?:[^'\\]|\\.)*)'[\s\S]{0,400}?other:\s*'((?:[^'\\]|\\.)*)'/g

  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) {
        if (name !== 'locales') walk(path)
        continue
      }

      if (!/\.(ts|svelte)$/.test(name) || name.endsWith('.test.ts')) continue

      for (const match of readFileSync(path, 'utf8').matchAll(pattern)) {
        if (match[2] && !found.has(match[2])) found.set(match[2], match[1])
      }
    }
  }

  walk(`${ROOT}apps/desktop/src`)
  return found
}

const quote = (text) =>
  `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`

/** `Save:` reads better than `'Save':`, and prettier writes it that way. */
const asKey = (text) => (/^[A-Za-z_$][\w$]*$/.test(text) ? text : quote(text))

/** What a catalogue's export is called: the id in camel case, because `pt-BR` is
 *  not a name. */
const exportName = (id) =>
  id
    .split('-')
    .map((part, at) => (at === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('')

function template(id, { rows, catalogue }, one) {
  const categories = new Intl.PluralRules(id).resolvedOptions().pluralCategories
  const forms = FORM_ORDER.filter((form) => categories.includes(form))

  const lines = [
    `import type { Dictionary } from '../lib/i18n.svelte.js'`,
    '',
    `export const ${exportName(id)}: Dictionary = {`,
  ]

  for (const { comments, key } of rows) {
    for (const comment of comments) lines.push(`  ${comment}`)

    // A row the reference holds as forms is a row a count decides.
    if (typeof catalogue[key] === 'string' || forms.length === 1) {
      lines.push(`  ${asKey(key)}: ${quote(key)},`)
      continue
    }

    const written = forms
      .map((form) => `${form}: ${quote(form === 'one' ? (one.get(key) ?? key) : key)}`)
      .join(', ')
    lines.push(`  ${asKey(key)}: { ${written} },`)
  }

  lines.push('}', '')
  return lines.join('\n')
}

const wanted = process.argv.slice(2)
if (!wanted.length) {
  console.error('which languages? e.g. node scripts/locale-template.mjs sv nl')
  process.exit(2)
}

const read = reference()
const one = singulars()
mkdirSync(OUT, { recursive: true })

for (const id of wanted) {
  writeFileSync(`${OUT}${id}.ts`, template(id, read, one), 'utf8')
  const categories = new Intl.PluralRules(id).resolvedOptions().pluralCategories
  console.log(`${OUT}${id}.ts - ${read.rows.length} rows, forms: ${categories.join(', ')}`)
}
