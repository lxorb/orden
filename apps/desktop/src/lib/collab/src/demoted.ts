import { account } from '../../accounts/src/api'

export const TOO_LARGE_FOR_A_ROOM = 'This note is as large as a note in a room may get.'

export function demoted(note: { reads: boolean } | null, leave: () => void, rejoin: () => void): Promise<void> {
  if (note) note.reads = true
  leave()
  return account
    .loadSpaces()
    .then(
      () => {
        if (note) note.reads = false
      },
      () => undefined,
    )
    .then(rejoin)
}
