import type { AgentAnswer } from '../../automation/caller'
import { copyText } from '../../clipboard'
import { asked } from './asks'
import { type Call, done, need, text } from './call'
import { Refused } from './problem'

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
