import { Collector, itemOf, loginOf, pick } from './build'
import { csvRecords } from './csv'
import type { Imported } from './types'

function parseChromium(text: string, vault: string): Imported {
  const into = new Collector(vault)
  for (const row of csvRecords(text)) {
    into.add(
      itemOf(
        loginOf({
          title: pick(row, 'name'),
          urls: [pick(row, 'url')],
          username: pick(row, 'username'),
          password: pick(row, 'password'),
          note: pick(row, 'note', 'notes'),
        }),
      ),
    )
  }
  return into.result()
}

export function parseChrome(text: string): Imported {
  return parseChromium(text, 'Chrome')
}

export function parseEdge(text: string): Imported {
  return parseChromium(text, 'Edge')
}

export function parseBrave(text: string): Imported {
  return parseChromium(text, 'Brave')
}
