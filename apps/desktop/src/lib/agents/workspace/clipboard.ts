/** The system clipboard: `system_clipboard` (docs/agent-native.md 8.14, #1078), as a VS Code
 *  extension's `env.clipboard` reads and writes it.
 *
 *  Its own scope, `clipboard`, which the reader's own agents hold and a third party is
 *  granted: what was copied last may be anything, a password included. Reading answers
 *  the words as the clipboard's, never the reader's (9.6); writing replaces them, and in
 *  `confirm` mode asks first as every write does (#1072). */

import type { AgentAnswer } from '../../automation/caller'
import { copyText } from '../../clipboard'
import { asked } from './asks'
import { type Call, done, need, text } from './call'
import { Refused } from './problem'

/** The most of the clipboard a read answers, and a write takes. */
const MOST = 1_000_000

export async function clipboard(call: Call): Promise<AgentAnswer> {
  const op = need(call, 'op')
  if (op === 'read') {
    const words = await navigator.clipboard.readText().catch(() => null)
    if (words === null) throw new Refused('failed', 'the clipboard could not be read')
    const cut = words.length > MOST
    return done(
      { text: cut ? words.slice(0, MOST) : words, ...(cut ? { truncated: true } : {}) },
      'clipboard',
    )
  }
  if (op === 'write') {
    const words = text(call, 'text')
    if (words === null) throw new Refused('bad_arguments', 'say text')
    if (words.length > MOST) throw new Refused('bad_arguments', `at most ${MOST} characters`)

    const question = await asked(call, null, `Copy ${words.length} characters to the clipboard`)
    if (question) return question

    await copyText(words)
    return done({ written: words.length })
  }
  throw new Refused('bad_arguments', 'op is read or write')
}
