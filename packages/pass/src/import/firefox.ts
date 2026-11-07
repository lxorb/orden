import { Collector, dateOf, itemOf, loginOf, pick } from './build'
import { csvRecords } from './csv'
import type { Imported } from './types'

export function parseFirefox(text: string): Imported {
  const into = new Collector('Firefox')
  for (const row of csvRecords(text)) {
    const url = pick(row, 'url')
    if (/^chrome:\/\//i.test(url)) continue
    const action = pick(row, 'formActionOrigin')
    const urls = [url, ...(action !== '' && action !== '.' ? [action] : [])]
    into.add(
      itemOf(
        loginOf({
          urls,
          username: pick(row, 'username'),
          password: pick(row, 'password'),
        }),
        {
          created: dateOf(pick(row, 'timeCreated')),
          modified: dateOf(pick(row, 'timePasswordChanged')),
        },
      ),
    )
  }
  return into.result()
}
