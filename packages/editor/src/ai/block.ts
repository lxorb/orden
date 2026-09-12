/** What an `ai` block looks like in the file.
 *
 *  The prompt is the body of a ```` ```ai ```` fence and the answer is ordinary
 *  markdown under it, so a note written here reads in Obsidian without a plugin:
 *  the fence is a code block holding the question, and the answer below it is
 *  prose, a list, a table, whatever came back.
 *
 *  What the answer needs beyond that is a way to be replaced when the question is
 *  asked again, and a way to say which model said it. Both are file content, so
 *  both had to be spellings markdown already has: two HTML comments around the
 *  answer, which every renderer hides and which @nib/markdown strips before it
 *  renders anything (see comments.ts there), and one italic line at the top of it.
 *
 *  So the whole of the format is:
 *
 *      ```ai
 *      Summarise @note in three bullets.
 *      ```
 *
 *      <!--nib:ai-->
 *      *answered by gpt-4o-mini, 2026-09-12*
 *
 *      - the first one
 *      - the second
 *      <!--/nib:ai-->
 *
 *  Nothing is registered anywhere and nothing is keyed: an answer belongs to the
 *  fence it sits under, which is the only binding a person editing the file by
 *  hand can see and keep. */

/** The fence language that makes a code block a question. */
const AI_LANGUAGE = 'ai'

export function isAiLanguage(language: string): boolean {
  return language.trim().toLowerCase() === AI_LANGUAGE
}

/** The two marks around an answer. Deliberately without a space inside the
 *  comment: Obsidian's own `%%` comment and every HTML one are hidden in reading
 *  view, and a mark nobody sees is a mark nobody has to keep tidy. */
export const ANSWER_OPEN = '<!--nib:ai-->'
export const ANSWER_CLOSE = '<!--/nib:ai-->'

/** What the prompt says to include the note it is written in. Obsidian's own
 *  spelling for "this file" in its plugins, and a word nothing else in a prompt
 *  can be mistaken for. */
const NOTE_MENTION = /@note\b/i

export function mentionsNote(prompt: string): boolean {
  return NOTE_MENTION.test(prompt)
}

/** Where an answer already written for the fence that ends on `closeLine` lives,
 *  or null where there is none yet.
 *
 *  Only an answer that follows the fence with nothing but blank lines between:
 *  anything else in the gap is the note's own prose, and the answer under it
 *  belongs to whatever comes after that. `to` is the end of the closing mark's
 *  line, so replacing the span replaces the answer and both marks with it.
 *
 *  Given the document as lines because that is what both callers have: the editor
 *  holds a rope and asks it for lines, and the test holds a string. */
export function answerSpan(
  lines: readonly string[],
  closeLine: number,
): { from: number; to: number } | null {
  let at = closeLine + 1
  while (at < lines.length && lines[at]?.trim() === '') at++

  if (lines[at]?.trim() !== ANSWER_OPEN) return null
  const opened = at

  while (at < lines.length && lines[at]?.trim() !== ANSWER_CLOSE) at++
  // An opening mark with no closing one is a half-written answer, which is what
  // an interrupted stream leaves behind. It is still this fence's answer, and the
  // rest of the note is not, so it ends where the note runs out.
  const closed = Math.min(at, lines.length - 1)

  return {
    from: offsetOf(lines, opened),
    to: offsetOf(lines, closed) + (lines[closed]?.length ?? 0),
  }
}

/** The character offset a line starts at, counting the newline after each line
 *  before it. */
function offsetOf(lines: readonly string[], line: number): number {
  let at = 0
  for (let index = 0; index < line; index++) at += (lines[index]?.length ?? 0) + 1
  return at
}

/** The quiet line over an answer. `label` is the wording the app translated, with
 *  `{model}` and `{date}` already filled in; this only puts it in italics, which
 *  is what makes it quiet in every renderer rather than only in nib's. */
function attribution(label: string): string {
  return `*${label}*`
}

/** What surrounds the answer itself: the opening mark and the line over it, and
 *  the closing mark under it.
 *
 *  Handed out in two halves because an answer arrives a word at a time: the two
 *  halves are written once, at the start, and every piece after that goes in
 *  between them. A blank line ends the head, so the answer's own first block is a
 *  block and not a continuation of the italic line; the tail opens with a newline
 *  and carries no blank one, which is what keeps an answer from growing a line
 *  every time it is replaced. */
export function answerParts(label: string): { head: string; tail: string } {
  return { head: `${ANSWER_OPEN}\n${attribution(label)}\n\n`, tail: `\n${ANSWER_CLOSE}` }
}

/** The whole of an answer, marks and attribution and all, as it goes into the
 *  file. */
export function answerText(label: string, answer: string): string {
  const { head, tail } = answerParts(label)
  return `${head}${answer.replace(/\s+$/, '')}${tail}`
}
