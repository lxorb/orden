/** A transcript, as takeaways and the tasks nobody has done yet.
 *
 *  It runs here for the one reason everything in this folder runs here: the
 *  account's OpenAI key is written and never read back, so the only thing that can
 *  spend it is the Worker that can open it. The key reaches this file through
 *  `keyFor` and through nothing else, which is also what makes a bring-your-own-key
 *  batch a change to one function rather than to every caller.
 *
 *  Nothing to do with the question flow beside it but the endpoint and the reader of
 *  its answer. A question is answered out of the account's notes with two tools and
 *  several rounds; a summary is one round over words that were handed in, with no
 *  tools at all, because a transcript is the whole of what there is to read and a
 *  model that went looking through the notes would be answering a different
 *  question. What they do share is `readReply`: one shape, read once.
 *
 *  The shape of the answer is the model's own. It is asked for two headings and
 *  writes them itself; nothing here rewrites what comes back, because a summary bent
 *  into a shape by this side is a summary about the shape. */

import { readReply } from './asking'
import { OPENAI } from './models'

/** What the model is told before the transcript. Short, for the reason the question
 *  flow's prompt is short: a long prompt is mostly a prompt about prompting. */
const PROMPT = [
  'You are given the transcript of a meeting, as a speech model heard it. It has',
  'mistakes in it and no speaker names.',
  '',
  'Write markdown, in the language the transcript is in, in this shape and nothing',
  'else:',
  '',
  '## Takeaways',
  '',
  'Three to six bullets. What was decided and what was learned, not what was said.',
  '',
  '## Open tasks',
  '',
  'A markdown task list - `- [ ] ` each - of what somebody now has to do, with who',
  'is to do it where the transcript says. Leave the heading out entirely if nothing',
  'was left open.',
  '',
  'Never invent a decision, a number or a name that is not in the transcript. Where',
  'the transcript is too garbled to summarise, say so in one bullet.',
].join('\n')

/** How much of a transcript goes to the model at once.
 *
 *  Sixty thousand characters, which is something like six hours of talking and far
 *  inside any model's window. A transcript longer than that is cut rather than
 *  refused, and the model is told it was cut so it does not write about an ending it
 *  never read - the same rule the question flow reads a long note by.
 *
 *  The route reads its field to this same number, so a client sending more is told
 *  so rather than quietly summarising the first part of what it sent. */
export const MOST_TRANSCRIPT = 60_000

/** Enough for a page of bullets. A summary that runs longer than the meeting is
 *  nobody's summary. */
const MOST_OUT = 1500

/** The summary, or the sentence to refuse with as an error.
 *
 *  Throws rather than answering an empty summary: the reader pressed stop and is
 *  waiting, and a note that quietly grew no takeaways looks like a bug in the
 *  recording rather than a model that would not answer. */
export async function summarise(
  text: string,
  asking: { key: string; model: string; effort: string },
): Promise<string> {
  const transcript =
    text.length > MOST_TRANSCRIPT
      ? `${text.slice(0, MOST_TRANSCRIPT)}\n\n[cut here; the meeting goes on]`
      : text

  const answered = await fetch(`${OPENAI}/v1/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${asking.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: asking.model,
      input: [
        { role: 'developer', content: PROMPT },
        { role: 'user', content: transcript },
      ],
      reasoning: { effort: asking.effort },
      max_output_tokens: MOST_OUT,
    }),
  })

  const body: unknown = await answered.json().catch(() => null)
  const reply = readReply(body)

  if (reply.refused) throw new Error(reply.refused)
  if (!answered.ok) throw new Error(`the model answered ${String(answered.status)}`)

  return reply.text.trim()
}
