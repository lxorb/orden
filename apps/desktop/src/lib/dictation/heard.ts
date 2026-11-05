/** What is asked of a transcriber, and what is kept of its answer. Pure.
 *
 *  The prompt is the one lever there is on names. Measured for #1128 on German, English
 *  and mixed dictation, a prompt of the words around the field moved names spelled right
 *  from 8 of 13 to 11-13 of 13, and the mixed error rate from 0.075 to 0.015-0.045. It
 *  is plain words rather than a sentence of the style wanted: a sentence came back as
 *  the transcript of a quiet stretch more than once.
 *
 *  And an answer is read with suspicion, because Whisper writes down what it has heard
 *  most often in silence, which is the end of a video. */

/** What a prompt may be: the route's own ceiling (services/sync/src/ask/index.ts), and
 *  well inside the 224 tokens Whisper reads of one. */
const MOST_PROMPT = 300

/** How much of the text before the caret goes along: the end of the sentence being
 *  continued, and the language it is in. */
const MOST_BEFORE = 160

/** A word around the field that is worth naming, at most this long. */
const MOST_WORD = 48

/** The words a field expects, then the text it continues: names first so a long text
 *  before never pushes them out. */
export function promptOf(before: string, words: readonly string[]): string {
  const named: string[] = []
  for (const word of words) {
    const one = word.replace(/\s+/g, ' ').trim()
    if (one && one.length <= MOST_WORD && !named.includes(one)) named.push(one)
  }

  const tail = tailOf(before)
  let list = named.join(', ')
  const room = MOST_PROMPT - tail.length - (tail ? 2 : 0)
  if (list.length > room) list = list.slice(0, Math.max(0, room)).replace(/,?\s*[^,]*$/, '')
  if (!list) return tail
  return tail ? `${list}. ${tail}` : list
}

/** The end of what comes before, from the start of a word. */
function tailOf(before: string): string {
  const text = before.replace(/\s+/g, ' ').trim()
  if (text.length <= MOST_BEFORE) return text
  const cut = text.slice(-MOST_BEFORE)
  const space = cut.indexOf(' ')
  return space < 0 ? cut : cut.slice(space + 1)
}

/** What a transcriber writes for silence, wherever in an answer it turns up: the
 *  credits of a subtitled video, which is what the model was trained on. A credit runs
 *  to the end of the answer, which is where it is written. */
const CREDITS = [
  /\s*Untertitel(?:ung)? (?:der|von|im Auftrag|des|durch)\b.*$/gi,
  /\s*\S*Amara\.org.*$/gi,
  /\s*Thanks? (?:you )?for watching[.!]?/gi,
  /\s*Copyright\b[^.!?]*(?:WDR|ZDF|SWR|NDR|BR|MDR)\b[^.!?]*[.!?]?/gi,
]

/** And what it writes for a breath or a click: a whole answer of one of these, from a
 *  stretch with less than a second of speech in it, is not what anybody said. */
const FILLERS =
  /^(?:obrigad[oa]|thank you|thanks|you|bye|danke|vielen dank|tschüss|e aí|merci|gracias)[.!]?$/i

/** How much speech a stretch must hold before a one-word answer is believed. */
const SURE_SECONDS = 1

/** The words of an answer, without what silence and the prompt put there. */
export function cleaned(text: string, prompt: string, spokenSeconds: number): string {
  let said = text
  for (const credit of CREDITS) said = said.replace(credit, '')
  said = said.replace(/\s+/g, ' ').trim()

  if (spokenSeconds < SURE_SECONDS && FILLERS.test(said)) return ''
  if (prompt && echoes(said, prompt)) return ''
  return said
}

/** Whether an answer is the prompt handed back, in whole or as a run of its names. */
function echoes(said: string, prompt: string): boolean {
  const plain = (one: string) =>
    one
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  const heard = plain(said)
  return heard.length > 0 && plain(prompt).includes(heard) && heard.split(' ').length >= 3
}
