/** The browser build's search, off the writing thread.
 *
 *  Reading a space of notes and scoring every line of them is work measured in
 *  hundreds of milliseconds, and on the page's own thread every one of those is
 *  a keystroke that does not appear. So it happens here: the worker opens the
 *  same storage the page does, walks it, and posts hits back as it finds them.
 *
 *  Nothing but the walk lives here. See search.ts for it, and search-client.ts
 *  for the side of the conversation the app holds. */

import { searchRows } from './search'
import { isAsk, type Answer } from './search-protocol'

self.onmessage = (event: MessageEvent<unknown>) => {
  const ask = event.data
  // A message that is not an ask is not this worker's business; see the note on
  // boundaries in docs/conventions.md.
  if (!isAsk(ask)) return

  const post = (answer: Answer) => {
    self.postMessage(answer)
  }

  searchRows(ask.root, ask.query, ask.terms, ask.limit, (found) => {
    post({ kind: 'found', id: ask.id, ...found })
  })
    .then(() => post({ kind: 'done', id: ask.id }))
    .catch(() => post({ kind: 'done', id: ask.id }))
}
