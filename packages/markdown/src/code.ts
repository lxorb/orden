/** What a code fence's info string says.
 *
 *  ```` ```ts src/main.ts ```` is a language and a caption: the first word says
 *  how to colour the code, and the rest says what the code is - the file it came
 *  from, or what it does - where the reader is already looking rather than in a
 *  sentence above the block.
 *
 *  The whole syntax is "the rest of the line", because that is what somebody
 *  types and because every markdown parser in the world already ignores it: the
 *  first word is the language and nothing reads further. So a note written here
 *  opens unchanged in Obsidian, renders unchanged on any other site, and loses
 *  only the caption. `title="…"`, which some other editors write, is read as the
 *  same thing rather than shown as itself, so a note that arrives from one of
 *  them says what it meant to say.
 *
 *  A caption needs a language in front of it. There is nowhere else for it to go:
 *  the first word of an info string is the language wherever markdown is read,
 *  and calling one thing two things depending on how many words follow it would
 *  be a rule nobody could see. */

/** How a caption is written by the editors that name it: `title="what it is"`,
 *  with either kind of quote or none at all. */
const TITLED = /^title\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/i

/** The language a fence names, lowercased by nobody: the first word of its info
 *  string, or the empty string. */
export function languageIn(info: string): string {
  return info.trim().split(/\s+/, 1)[0] ?? ''
}

/** The caption a fence carries, or the empty string. */
export function captionIn(info: string): string {
  const rest = info.trim().slice(languageIn(info).length).trim()
  const titled = TITLED.exec(rest)

  return titled ? (titled[1] ?? titled[2] ?? titled[3] ?? '') : rest
}
