#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PASS = join(ROOT, 'packages/pass')
const SOURCE = 'https://api.2fa.directory/v4/totp.json'

const { getDomain } = createRequire(join(PASS, 'package.json'))('tldts')

const response = await fetch(SOURCE)
if (!response.ok) throw new Error(`${SOURCE} answered ${response.status}`)
const listed = await response.json()

const entries = Array.isArray(listed) ? listed : Object.entries(listed)
const sites = new Set()
for (const [key, entry] of entries) {
  const names = [key, entry?.domain, ...(entry?.['additional-domains'] ?? [])]
  for (const name of names) {
    if (typeof name !== 'string') continue
    const site = getDomain(name.trim().toLowerCase(), { allowPrivateDomains: true })
    if (site) sites.add(site)
  }
}
if (sites.size < 500) throw new Error(`${SOURCE} listed only ${sites.size} sites`)

const words = [...sites].sort()
const lines = []
let line = ''
for (const word of words) {
  if (line !== '' && line.length + word.length + 1 > 100) {
    lines.push(line)
    line = word
  } else {
    line = line === '' ? word : `${line} ${word}`
  }
}
if (line !== '') lines.push(line)

const out = `const LISTED = \`
${lines.join('\n')}
\`

export const TWO_FACTOR_SITES: ReadonlySet<string> = new Set(LISTED.trim().split(/\\s+/))

export function offersTwoFactor(site: string): boolean {
  return TWO_FACTOR_SITES.has(site.trim().toLowerCase())
}
`
writeFileSync(join(PASS, 'src/two-factor.ts'), out)
console.log(`two-factor.ts: ${words.length} sites`)
