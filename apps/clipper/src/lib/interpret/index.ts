/** The one call: a page and a template in, the properties they fill out.
 *
 *  The half of the interpreter that talks to a network, and the only file in this
 *  folder that does. Two places ask it the same question - the popup, which shows
 *  the properties in its preview before anything is saved and can abort by being
 *  closed, and the service worker, for a clip from the page's own menu or a
 *  keyboard shortcut, which has no popup to show anything in. Both get the same
 *  answer for the same page, which is the rule the rest of the clipper already
 *  follows.
 *
 *  Nothing throws. Every way this can fail is one sentence, and a failure costs
 *  the clip its extra properties and nothing else: the note is written, saved and
 *  named exactly as it would have been with no provider at all. */

import { PROBLEMS } from '../problems'
import { parsed } from '../stored'
import { type Page, promptFor } from './prompt'
import {
  modelsRequest,
  OLLAMA,
  readModels,
  readReply,
  ready,
  refusalIn,
  requestFor,
  type Setup,
} from './providers'
import type { Template } from './templates'
import { type Filled, readFilled } from './values'

export type Interpreted = { filled: Filled[] } | { problem: string }

/** One round trip: the line the model said, or the sentence to show for it and
 *  whether it is worth asking again without the provider's JSON mode - the one
 *  refusal worth answering rather than reporting. */
type Tried = { reply: string } | { problem: string; retry: boolean }

async function tried(
  setup: Setup,
  prompt: { system: string; user: string },
  json: boolean,
  signal: AbortSignal | undefined,
): Promise<Tried> {
  const { url, headers, body } = requestFor(setup, prompt, json)

  let response: Response
  let said: unknown
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    })

    said = parsed(await response.text())
  } catch {
    // No network, a server that is not running, an address that is not one, or
    // the caller having given up: none of them is a problem for the clip.
    return { problem: PROBLEMS.provider, retry: false }
  }

  if (!response.ok) {
    // A server old enough not to know `response_format` says so as a 400 rather
    // than by ignoring the field, so a 400 to the asking-for-JSON request is worth
    // one more try without it.
    const worth = json && response.status === 400
    return { problem: refusalIn(said) ?? PROBLEMS.provider, retry: worth }
  }

  const reply = readReply(setup.provider, said)
  return reply ? { reply } : { problem: PROBLEMS.unreadable, retry: false }
}

/** The question, asked: with the provider's JSON mode, and again without it where
 *  the server turned out not to know the field. Whatever it says the second time is
 *  what it says - a server refusing the plain request is refusing. */
async function asked(
  setup: Setup,
  prompt: { system: string; user: string },
  signal: AbortSignal | undefined,
): Promise<{ reply: string } | { problem: string }> {
  const once = await tried(setup, prompt, true, signal)
  if ('reply' in once) return once
  if (!once.retry) return { problem: once.problem }

  // Said again, and the flag left behind: whether it was worth asking twice is
  // this function's business and nobody else's.
  const again = await tried(setup, prompt, false, signal)
  return 'reply' in again ? again : { problem: again.problem }
}

/** The properties a template's questions fill in for a page.
 *
 *  A template with no properties, or a provider that is not set up, is not a
 *  failure: it is nothing to ask, and the answer is nothing filled in. */
export async function interpret(
  page: Page,
  template: Template,
  setup: Setup,
  signal?: AbortSignal,
): Promise<Interpreted> {
  if (!template.fields.length || !ready(setup)) return { filled: [] }

  const answered = await asked(setup, promptFor(page, template), signal)
  if ('problem' in answered) return answered

  const filled = readFilled(answered.reply, template)
  return filled ? { filled } : { problem: PROBLEMS.unreadable }
}

/** What models a provider has, or an empty list when it will not say. Asked by
 *  the options page so a model is picked from what is there rather than typed
 *  from memory; a provider that answers nothing leaves the field to be typed. */
export async function modelsOf(setup: Setup): Promise<string[]> {
  const { url, headers } = modelsRequest(setup)

  try {
    const response = await fetch(url, { headers })
    return response.ok ? readModels(parsed(await response.text())) : []
  } catch {
    return []
  }
}

/** How long a look for something on this machine may take. It is either running
 *  on this port or it is not, and a person waiting for a settings page to finish
 *  drawing should not be waiting on a network at all. */
const PROBE = 1200

/** The models Ollama has on this machine, or null when nothing answers there.
 *
 *  Local first: a model on the machine costs nothing, sends the page nowhere and
 *  is what most people who run one already have, so the options page looks for it
 *  and offers it rather than making somebody find the address. Null and an empty
 *  list are different answers - something answering with no models pulled yet is
 *  worth saying so about. */
export async function ollamaModels(): Promise<string[] | null> {
  try {
    const response = await fetch(`${OLLAMA}/models`, { signal: AbortSignal.timeout(PROBE) })
    return response.ok ? readModels(parsed(await response.text())) : null
  } catch {
    return null
  }
}
