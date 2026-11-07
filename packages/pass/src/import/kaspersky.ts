import { Collector, fieldsOf, itemOf, loginOf, noteOf } from './build'
import type { Imported } from './types'

const HEADERS = ['Websites', 'Applications', 'Other Accounts', 'Notes'] as const

type Header = (typeof HEADERS)[number]

const LONG_KEYS = new Set(['Comment', 'Text'])

function entryOf(lines: readonly string[]): Map<string, string> {
  const entry = new Map<string, string>()
  let long: string | null = null
  for (const line of lines) {
    if (long !== null) {
      entry.set(long, `${entry.get(long) ?? ''}\n${line}`)
      continue
    }
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).replace(/^ /, '')
    entry.set(key, value)
    if (LONG_KEYS.has(key)) long = key
  }
  for (const key of LONG_KEYS) {
    const value = entry.get(key)
    if (value !== undefined) entry.set(key, value.replace(/\s+$/, ''))
  }
  return entry
}

function sectionsOf(text: string): { header: Header; entries: Map<string, string>[] }[] {
  const sections: { header: Header; entries: Map<string, string>[] }[] = []
  let current: { header: Header; entries: Map<string, string>[] } | null = null
  let lines: string[] = []
  const flush = (): void => {
    if (current && lines.some((line) => line.trim() !== '')) current.entries.push(entryOf(lines))
    lines = []
  }
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const header = HEADERS.find((one) => one === line.trim())
    if (header && lines.every((one) => one.trim() === '')) {
      flush()
      current = { header, entries: [] }
      sections.push(current)
    } else if (line.trim() === '---') {
      flush()
    } else if (current) {
      lines.push(line)
    }
  }
  flush()
  return sections
}

export function parseKaspersky(text: string): Imported {
  const into = new Collector('Kaspersky')
  for (const { header, entries } of sectionsOf(text)) {
    for (const entry of entries) {
      const get = (...keys: string[]): string => {
        for (const key of keys) {
          const value = entry.get(key)
          if (value !== undefined && value !== '') return value
        }
        return ''
      }
      if (header === 'Notes') {
        into.add(itemOf(noteOf(get('Name'), get('Text'))))
        continue
      }
      into.add(
        itemOf(
          loginOf({
            title: get('Website name', 'Application', 'Account name'),
            urls: [get('Website URL')],
            username: get('Login'),
            password: get('Password'),
            note: get('Comment'),
            fields: fieldsOf([{ name: 'Login name', value: get('Login name') }]),
          }),
          { folder: header === 'Websites' ? null : header },
        ),
      )
    }
  }
  return into.result()
}
