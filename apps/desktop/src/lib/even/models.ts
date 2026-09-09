/** Which models the reader may choose, asked of the API rather than guessed.
 *
 *  Model names change every few months and a list written down here would be a
 *  list of models that used to exist. So the settings ask `GET /v1/models` with
 *  the reader's own key and offer what came back, narrowed to the four families
 *  worth putting in front of somebody: `astra`, `sol`, `luna` and `terra`.
 *
 *  Narrowed rather than shown whole because the endpoint answers with a hundred
 *  and twenty five ids, most of them dated snapshots, transcription models,
 *  embedding models and things that cannot hold a conversation at all. A list like
 *  that in a settings pane is not a choice, it is a filing cabinet.
 *
 *  The four families were verified against the endpoint on 2026-09-09: it answered
 *  `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-luna` and `gpt-5.6-terra`. Nothing here
 *  depends on those exact strings; they are what the filter found, and it will find
 *  whatever replaces them. */

/** The families, in the order they are offered. Newest first, which is also the
 *  order of the reader's likely preference. */
const FAMILIES = ['astra', 'sol', 'luna', 'terra'] as const

/** A dated snapshot of a model, which is never what a settings pane should offer:
 *  a reader who picks one is pinned to it until they notice. */
const DATED = /-\d{4}-\d{2}-\d{2}$/

/** How hard the model is asked to think. The API's own list, read off the error it
 *  answers an invalid one with, so it is the API's and not a guess. */
export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
}

/** Where the request goes. One origin, and it has to be on the manifest's own
 *  network whitelist or the phone app blocks it before it leaves the WebView. */
export const OPENAI = 'https://api.openai.com'

/** The ids the account may choose, in family order.
 *
 *  Answers an empty list rather than throwing: a key that is wrong, an account
 *  with no credit and a phone with no signal are all "no models to offer", and the
 *  settings pane says so in one line rather than in a dialog. */
export async function modelsFor(key: string): Promise<string[]> {
  if (!key) return []

  const answer = await fetch(`${OPENAI}/v1/models`, {
    headers: { authorization: `Bearer ${key}` },
  })
  if (!answer.ok) return []

  const body: unknown = await answer.json()
  return chosenOf(body)
}

/** The ids worth offering, out of whatever the endpoint answered.
 *
 *  Read field by field, because this is a boundary: what comes back is JSON from
 *  somebody else's server and is unknown until it has been checked. */
export function chosenOf(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return []

  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) return []

  const ids = data
    .map((one) =>
      typeof one === 'object' && one !== null && typeof (one as { id?: unknown }).id === 'string'
        ? (one as { id: string }).id
        : '',
    )
    .filter((id) => id !== '' && !DATED.test(id))

  const out: string[] = []
  for (const family of FAMILIES) {
    // The shortest id in the family, which is the alias rather than a variant of
    // it: `gpt-5.6-sol` over `gpt-5.6-sol-preview`.
    const found = ids
      .filter((id) => id.endsWith(`-${family}`) || id === family)
      .sort((a, b) => a.length - b.length)
    const first = found[0]
    if (first !== undefined) out.push(first)
  }

  return out
}
