import { Collector, dateOf, itemOf, loginOf, noteOf, pick } from './build'
import { csvRecords } from './csv'
import type { Imported } from './types'

const RECYCLE_BIN = 'Recycle Bin'

export function parseKeePassXC(text: string): Imported {
  const into = new Collector('KeePassXC')
  for (const row of csvRecords(text)) {
    const path = pick(row, 'Group').split('/').slice(1)
    const trashed = path[0] === RECYCLE_BIN
    const folder = (trashed ? path.slice(1) : path).join('/')
    const username = pick(row, 'Username')
    const password = pick(row, 'Password')
    const url = pick(row, 'URL')
    const totp = pick(row, 'TOTP')
    const title = pick(row, 'Title')
    const note = pick(row, 'Notes')
    const content =
      username === '' && password === '' && url === '' && totp === ''
        ? noteOf(title, note)
        : loginOf({ title, username, password, urls: [url], note, totp })
    into.add(
      itemOf(content, {
        created: dateOf(pick(row, 'Created')),
        modified: dateOf(pick(row, 'Last Modified')),
        trashed,
        folder,
      }),
    )
  }
  return into.result()
}
