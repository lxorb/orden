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

export const parseChrome = (text: string): Imported => parseChromium(text, 'Chrome')
export const parseEdge = (text: string): Imported => parseChromium(text, 'Edge')
export const parseBrave = (text: string): Imported => parseChromium(text, 'Brave')
