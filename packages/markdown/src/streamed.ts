/** Markdown as a model writes it, made into markdown as a note is written: one
 *  grammar for both, so an answer read in the AI panel, written into a note by an
 *  `ai` block or inserted at the caret draws the same way the note around it does.
 *
 *  Two differences, and both are about where the words come from rather than what
 *  they are.
 *
 *  A model writes its formulas the way LaTeX does, `\(…\)` inline and `\[…\]` on a
 *  line of their own, as often as the way a note does, `$…$` and `$$…$$`. A note's
 *  grammar keeps the backslash for what CommonMark keeps it for - `\[` is a bracket
 *  that is not a link, and a note clipped from a page is full of them - so the
 *  answer is spelled the note's way instead, once, on its way in. `TexDelimiters`
 *  does that over a stream, piece by piece, holding back nothing but a character it
 *  cannot yet read; `dollarMaths` is the same over a whole text.
 *
 *  And an answer is drawn while it is still arriving, which a note never is: a
 *  formula, a code span or a bold run whose closing half is in the next piece.
 *  `settled` closes what the last line left open, so the words read as what they
 *  are about to be rather than as their own punctuation. A fence needs nothing: an
 *  unclosed one runs to the end of the document, which is the code it is. */

type Maths = 'inline' | 'display' | null

/** A space or a tab: what a formula's delimiter may have around it and its `$` may not. */
const BLANK = /[ \t]/

/** What may stand at a line's start in front of a fence: indentation, quote marks and
 *  list markers, which is where a fence inside a quote or a list item opens. */
const LINE_LEAD = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*/

/** The way from LaTeX's delimiters to a note's, over a stream.
 *
 *  `push` takes the next piece and answers what can be written of everything so far;
 *  `end` answers the rest once nothing more is coming. Nothing inside code - a fence
 *  or a code span - is touched, and an escaped backslash is the pair it is, so the
 *  `\\[2pt]` of a matrix row stays a line break with a length after it. */
export class TexDelimiters {
  #rest = ''
  #fence: { mark: string; size: number } | null = null
  /** The backticks the open code span was opened with, or 0. */
  #code = 0
  #maths: Maths = null
  /** Whether the next character read is the first of its line. */
  #fresh = true
  /** Whether this line has had anything on it but blanks and quote marks. */
  #words = false
  /** Whether the line before this one had. */
  #wordsBefore = true
  /** The last character written, which a closing `$$` is put on a line of its own by. */
  #last = '\n'
  /** A `$$` just closed a block: the next words go on the line after it. */
  #breakNext = false

  push(piece: string): string {
    this.#rest += piece
    return this.#run(false)
  }

  end(): string {
    return this.#run(true)
  }

  #run(final: boolean): string {
    const text = this.#rest
    let out = ''
    let at = 0

    const write = (words: string) => {
      if (!words) return
      if (this.#breakNext) {
        this.#breakNext = false
        if (!words.startsWith('\n')) out += '\n'
      }
      out += words
      this.#last = words.at(-1) ?? this.#last
    }
    /** Past the blanks from `from`. */
    const blanks = (from: number) => {
      let to = from
      while (to < text.length && BLANK.test(text.charAt(to))) to++
      return to
    }
    /** Past the run of the character at `from`. */
    const run = (from: number) => {
      let to = from
      while (to < text.length && text[to] === text[from]) to++
      return to
    }

    // Each turn reads one thing and writes it, or stops where what it reads could
    // still turn out to be something else once the next piece is here.
    reading: while (at < text.length) {
      const one = text.charAt(at)

      if (one === '\n') {
        write('\n')
        at++
        // A blank line ends a paragraph, and with it a code span or an inline
        // formula nobody closed: neither runs on past one.
        if (!this.#words && !this.#wordsBefore) {
          this.#code = 0
          if (this.#maths === 'inline') this.#maths = null
        }
        this.#wordsBefore = this.#words
        this.#words = false
        this.#fresh = true
        continue
      }

      if (this.#fence) {
        const end = text.indexOf('\n', at)
        const line = end === -1 ? text.slice(at) : text.slice(at, end)
        if (this.#fresh) {
          // Whether this line closes the fence, which a line that is not yet whole
          // may still turn out to.
          const lead = /^[ \t>]*/.exec(line)?.[0].length ?? 0
          const mark = this.#fence.mark
          const rest = line.slice(lead)
          const could = new RegExp(`^\\${mark}*[ \\t]*$`).test(rest)
          if (could && end === -1 && !final) break reading
          const marks = rest.length - rest.replace(new RegExp(`^\\${mark}+`), '').length
          if (could && marks >= this.#fence.size) this.#fence = null
        }
        this.#fresh = false
        this.#words = true
        write(line)
        at += line.length
        continue
      }

      if (this.#fresh && this.#code === 0 && this.#maths === null) {
        // Whether this line opens a fence: its lead, then three of one mark.
        const lead = LINE_LEAD.exec(text.slice(at))?.[0].length ?? 0
        const from = at + lead
        if (from === text.length && !final) break reading
        const mark = text.charAt(from)
        if (mark === '`' || mark === '~') {
          const to = run(from)
          if (to === text.length && !final) break reading
          if (to - from >= 3) {
            this.#fence = { mark, size: to - from }
            this.#fresh = false
            this.#words = true
            write(text.slice(at, to))
            at = to
            continue
          }
        }
        this.#fresh = false
      }

      if (one === '`' && this.#maths === null) {
        const to = run(at)
        if (to === text.length && !final) break reading
        const size = to - at
        if (this.#code === 0) this.#code = size
        else if (this.#code === size) this.#code = 0
        this.#words = true
        write(text.slice(at, to))
        at = to
        continue
      }

      if (this.#code > 0) {
        write(one)
        at++
        continue
      }

      if (one === '\\') {
        if (at + 1 === text.length) {
          if (!final) break reading
          write(one)
          at++
          continue
        }
        const next = text.charAt(at + 1)
        const spoken = this.#words
        this.#words = true

        if (next === '(' && this.#maths === null) {
          const from = blanks(at + 2)
          if (from === text.length && !final) break reading
          write('$')
          this.#maths = 'inline'
          at = from
          continue
        }

        if (next === '[' && this.#maths === null) {
          const from = blanks(at + 2)
          if (from === text.length && !final) break reading
          // A `$$` block takes whole lines: one formula in the middle of a sentence
          // is a display formula there, which in a note is a line of its own.
          write(spoken && this.#last !== '\n' ? '\n$$' : '$$')
          if (text.charAt(from) !== '\n') write('\n')
          this.#maths = 'display'
          at = from
          continue
        }

        if (next === ')' && this.#maths === 'inline') {
          write('$')
          this.#maths = null
          at += 2
          continue
        }

        if (next === ']' && this.#maths === 'display') {
          write(this.#last === '\n' ? '$$' : '\n$$')
          this.#maths = null
          this.#breakNext = true
          at += 2
          continue
        }

        // Anything else escaped, and the pair `\\`, is written as it stands.
        write(text.slice(at, at + 2))
        at += 2
        continue
      }

      if (BLANK.test(one) && this.#maths !== null) {
        // The blanks just inside a delimiter go: a note's `$` may not have any.
        const to = blanks(at)
        const closer = this.#maths === 'inline' ? '\\)' : '\\]'
        const ahead = text.slice(to)
        if (!final && ahead.length < closer.length && closer.startsWith(ahead)) break reading
        if (!text.startsWith(closer, to)) write(text.slice(at, to))
        at = to
        continue
      }

      if (one !== '>' && !BLANK.test(one)) this.#words = true
      write(one)
      at++
    }

    this.#rest = text.slice(at)
    return out
  }
}

/** A whole text with LaTeX's delimiters spelled a note's way. */
export function dollarMaths(text: string): string {
  if (!text.includes('\\(') && !text.includes('\\[')) return text
  const spelled = new TexDelimiters()
  return spelled.push(text) + spelled.end()
}

/** A formula's source, for the open inline one at the end of a line: where it says
 *  something only TeX would, it is a formula on its way rather than a price. */
const TEX_LIKE = /[\\^_{}]/

/** The markdown of an answer still arriving, with what its last line left open
 *  closed: a `$$` block, a code span, a bold run, a formula. What `dollarMaths` has
 *  already been over, so only a note's own spellings are asked about. */
export function settled(text: string): string {
  let fence: { mark: string; size: number } | null = null
  /** Where the open `$$` block's line starts, and what of the formula is on it. */
  let display: { at: number; inline: string } | null = null
  let last = ''
  let at = 0

  for (const line of text.split('\n')) {
    const start = at
    at += line.length + 1
    last = line
    const lead = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*/.exec(line)?.[0].length ?? 0
    const rest = line.slice(lead)
    if (fence) {
      const marks = /^(`+|~+)[ \t]*$/.exec(rest.replace(/^[ \t>]*/, ''))?.[1]
      if (marks?.[0] === fence.mark && marks.length >= fence.size) fence = null
      continue
    }
    if (display) {
      if (rest.trimEnd().endsWith('$$')) display = null
      continue
    }
    const opens = /^(`{3,}|~{3,})/.exec(rest)?.[1]
    if (opens) {
      fence = { mark: opens.charAt(0), size: opens.length }
      continue
    }
    const trimmed = rest.trimEnd()
    if (trimmed.startsWith('$$') && !(trimmed.length > 4 && trimmed.endsWith('$$'))) {
      display = { at: start, inline: trimmed.slice(2).trim() }
    }
  }

  // An open fence runs to the end, which is the code it is.
  if (fence) return text
  if (display) {
    const formula = text.slice(display.at).replace(/^[^$]*\$\$/, '')
    // Nothing of it yet: the block is not drawn until there is something to draw.
    if (!formula.trim()) return text.slice(0, display.at).trimEnd()
    // Still on the line it opened on, which is a block on one line.
    if (!formula.includes('\n')) return `${text.trimEnd()}$$`
    return `${text.trimEnd()}\n$$`
  }

  const closers = closersFor(last.trimEnd())
  return closers ? text.trimEnd() + closers : text
}

/** What closes the marks a line left open, innermost first. */
function closersFor(line: string): string {
  const open: { mark: string; at: number }[] = []
  let at = 0

  while (at < line.length) {
    const one = line.charAt(at)
    if (one === '\\') {
      at += 2
      continue
    }
    if (one === '`') {
      let to = at
      while (line[to] === '`') to++
      const mark = line.slice(at, to)
      const close = line.indexOf(mark, to)
      if (close === -1) {
        open.push({ mark, at })
        break
      }
      at = close + mark.length
      continue
    }
    if (one === '$') {
      if (line[at + 1] === '$') {
        at += 2
        continue
      }
      const top = open.at(-1)
      if (top?.mark === '$') open.pop()
      else open.push({ mark: '$', at })
      at++
      continue
    }
    if (one === '*' && line[at + 1] === '*') {
      const top = open.at(-1)
      if (top?.mark === '**') open.pop()
      else if (!open.some((one) => one.mark === '$')) open.push({ mark: '**', at })
      at += 2
      continue
    }
    at++
  }

  let close = ''
  for (const one of open.reverse()) {
    // A `$` with nothing TeX after it is as likely a price as a formula.
    const formula = line.slice(one.at + 1)
    if (one.mark === '$' && (!/^\S/.test(formula) || !TEX_LIKE.test(formula))) continue
    close += one.mark
  }
  return close
}
