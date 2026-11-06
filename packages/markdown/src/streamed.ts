type Maths = 'inline' | 'display' | null

const BLANK = /[ \t]/

const LINE_LEAD = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*/

export class TexDelimiters {
  #rest = ''
  #fence: { mark: string; size: number } | null = null
  #code = 0
  #maths: Maths = null
  #fresh = true
  #words = false
  #wordsBefore = true
  #last = '\n'
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
    const blanks = (from: number) => {
      let to = from
      while (to < text.length && BLANK.test(text.charAt(to))) to++
      return to
    }
    const run = (from: number) => {
      let to = from
      while (to < text.length && text[to] === text[from]) to++
      return to
    }

    reading: while (at < text.length) {
      const one = text.charAt(at)

      if (one === '\n') {
        write('\n')
        at++
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

        write(text.slice(at, at + 2))
        at += 2
        continue
      }

      if (BLANK.test(one) && this.#maths !== null) {
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

export function dollarMaths(text: string): string {
  if (!text.includes('\\(') && !text.includes('\\[')) return text
  const spelled = new TexDelimiters()
  return spelled.push(text) + spelled.end()
}

const TEX_LIKE = /[\\^_{}]/

export function settled(text: string): string {
  let fence: { mark: string; size: number } | null = null
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

  if (fence) return text
  if (display) {
    const formula = text.slice(display.at).replace(/^[^$]*\$\$/, '')
    if (!formula.trim()) return text.slice(0, display.at).trimEnd()
    if (!formula.includes('\n')) return `${text.trimEnd()}$$`
    return `${text.trimEnd()}\n$$`
  }

  const closers = closersFor(last.trimEnd())
  return closers ? text.trimEnd() + closers : text
}

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
    const formula = line.slice(one.at + 1)
    if (one.mark === '$' && (!/^\S/.test(formula) || !TEX_LIKE.test(formula))) continue
    close += one.mark
  }
  return close
}
