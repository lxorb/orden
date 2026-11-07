import { Collector, itemOf, loginOf, pick, urlsIn } from './build'
import { csvRecords } from './csv'
import type { Imported } from './types'

export function parseSafari(text: string): Imported {
  const into = new Collector('Safari')
  for (const row of csvRecords(text)) {
    into.add(
      itemOf(
        loginOf({
          title: pick(row, 'Title'),
          urls: urlsIn(pick(row, 'URL', 'Website')),
          username: pick(row, 'Username', 'User Name'),
          password: pick(row, 'Password'),
          note: pick(row, 'Notes', 'Note'),
          totp: pick(row, 'OTPAuth', 'OTP Auth', 'Verification Code'),
        }),
      ),
    )
  }
  return into.result()
}
