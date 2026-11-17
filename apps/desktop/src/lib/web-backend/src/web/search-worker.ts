import { searchRows } from './search'
import { type Answer, isAsk, isWarm } from './search-protocol'
import { space } from './space-cache'
import { watchRows } from './store'

function post(answer: Answer) {
  self.postMessage(answer)
}

function warmth() {
  post({ kind: 'warmth', warmth: space.warmth() })
}

let hearing = Promise.resolve()
watchRows((change) => {
  hearing = hearing.then(async () => {
    for (const path of change.gone) space.gone(path)
    for (const path of change.written) await space.rewritten(path).catch(() => undefined)
    warmth()
  })
})

self.onmessage = (event: MessageEvent<unknown>) => {
  const told = event.data
  if (isWarm(told)) {
    void space
      .fill(told.root)
      .catch(() => undefined)
      .then(warmth)
    return
  }

  if (!isAsk(told)) return

  searchRows(
    told.root,
    told.query,
    told.terms,
    told.limit,
    (found) => {
      post({ kind: 'found', id: told.id, ...found })
    },
    told.excluded,
  )
    .then(() => {
      post({ kind: 'done', id: told.id })
      warmth()
    })
    .catch(() => post({ kind: 'done', id: told.id }))
}
